import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import AdmZip from 'adm-zip';
import PptxGenJS from 'pptxgenjs';
import ExcelJS from 'exceljs';
import { inspect } from './validation';

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const unsafe = { code: 'UNSAFE_OR_INVALID_DOCUMENT', status: 422 };

// Generated public test data only: never depend on or commit a private deck.
let fixture: Promise<Buffer> | undefined;
function chartDeck() {
  return fixture ??= (async () => {
    const deck = new PptxGenJS();
    deck.addSlide().addChart(deck.ChartType.bar, [
      { name: 'Example series', labels: ['A', 'B'], values: [10, 20] },
    ], { x: 1, y: 1, w: 8, h: 4 });
    return Buffer.from(await deck.write({ outputType: 'nodebuffer' }) as Buffer);
  })();
}
function embeddedName(zip: AdmZip) {
  const entry = zip.getEntries().find(e => !e.isDirectory && e.entryName.endsWith('.xlsx'));
  assert.ok(entry);
  return entry.entryName;
}
function changeXml(zip: AdmZip, name: string, change: (xml: string) => string) {
  const entry = zip.getEntry(name);
  assert.ok(entry);
  const old = entry.getData().toString();
  const next = change(old);
  assert.notEqual(next, old, 'test mutation must change the fixture');
  zip.updateFile(name, Buffer.from(next));
}
async function mutateOuter(change: (zip: AdmZip) => void) {
  const zip = new AdmZip(await chartDeck());
  change(zip);
  return zip.toBuffer();
}
async function mutateWorkbook(change: (zip: AdmZip) => void) {
  return mutateOuter(outer => {
    const name = embeddedName(outer);
    const workbook = new AdmZip(outer.getEntry(name)!.getData());
    change(workbook);
    outer.updateFile(name, workbook.toBuffer());
  });
}
function extraRelationship(zip: AdmZip, name: string, type: string, target: string) {
  changeXml(zip, name, xml => xml.replace('</Relationships>',
    `<Relationship Id="bad" Type="${type}" Target="${target}"/></Relationships>`));
}
function appendWorksheet(zip: AdmZip, xml: string) {
  changeXml(zip, 'xl/worksheets/sheet1.xml', old => old.replace('</worksheet>', `${xml}</worksheet>`));
}

test('editable chart PPTX accepts generated workbooks, multiple charts, and ExcelJS chart data', async t => {
  const bytes = await chartDeck();
  await t.test('generated editable chart', async () => assert.equal(await inspect(bytes, 'pptx'), 0));
  // Multiple charts have independent, validated workbooks and shared budgets.
  const deck = new PptxGenJS();
  for (let i = 0; i < 2; i++) deck.addSlide().addChart(deck.ChartType.bar,
    [{ name: 'Example', labels: ['A'], values: [i + 1] }], { x: 1, y: 1, w: 5, h: 3 });
  await t.test('multiple charts', async () => assert.equal(await inspect(Buffer.from(await deck.write({ outputType: 'nodebuffer' }) as Buffer), 'pptx'), 0));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.addRow(['Label', 'Value']);
  sheet.addRow(['A', 10]);
  sheet.getCell('B3').value = { formula: 'SUM(B2:B2)', result: 10 };
  const replacement = Buffer.from(await workbook.xlsx.writeBuffer());
  await t.test('ExcelJS chart data', async () => assert.equal(await inspect(await mutateOuter(zip => zip.updateFile(embeddedName(zip), replacement)), 'pptx'), 0));
  // OPC package-absolute internal targets are allowed, not treated as URLs.
  await t.test('package-absolute target', async () => assert.equal(await inspect(await mutateOuter(zip => changeXml(zip, 'ppt/charts/_rels/chart1.xml.rels',
    xml => xml.replace('Target="../embeddings/', 'Target="/ppt/embeddings/'))), 'pptx'), 0));
});

test('chart workbook allowance requires the complete typed presentation/slide/chart relationship chain', async t => {
  const cases: [string, (zip: AdmZip) => void][] = [
    ['unreferenced embedding', zip => zip.deleteFile('ppt/charts/_rels/chart1.xml.rels')],
    ['wrong package relationship type', zip => changeXml(zip, 'ppt/charts/_rels/chart1.xml.rels', xml => xml.replace(`${R}/package`, `${R}/image`))],
    ['OLE relationship', zip => changeXml(zip, 'ppt/charts/_rels/chart1.xml.rels', xml => xml.replace(`${R}/package`, `${R}/oleObject`))],
    ['external workbook', zip => changeXml(zip, 'ppt/charts/_rels/chart1.xml.rels', xml => xml.replace('Target=', 'TargetMode="Ext&#101;rnal" Target='))],
    ['URI encoded target', zip => changeXml(zip, 'ppt/charts/_rels/chart1.xml.rels', xml => xml.replace('../embeddings/', '../%65mbeddings/'))],
    ['escaping target', zip => changeXml(zip, 'ppt/charts/_rels/chart1.xml.rels', xml => xml.replace('../embeddings/', '../../../../embeddings/'))],
    ['fragment target', zip => changeXml(zip, 'ppt/charts/_rels/chart1.xml.rels', xml => xml.replace('.xlsx"', '.xlsx#part"'))],
    ['missing chart externalData reference', zip => changeXml(zip, 'ppt/charts/chart1.xml', xml => xml.replace(/<c:externalData[\s\S]*?<\/c:externalData>/, ''))],
    ['unreferenced chart', zip => changeXml(zip, 'ppt/slides/slide1.xml', xml => xml.replace(/<c:chart\b[^>]*\/>/, ''))],
    ['unreferenced slide', zip => changeXml(zip, 'ppt/presentation.xml', xml => xml.replace(/<p:sldId\b[^>]*\/>/, ''))],
    ['wrong workbook content type', zip => changeXml(zip, '[Content_Types].xml', xml => xml.replace('spreadsheetml.sheet"', 'spreadsheetml.template"'))],
    ['wrong chart content type', zip => changeXml(zip, '[Content_Types].xml', xml => xml.replace('drawingml.chart+xml', 'drawingml.chartshapes+xml'))],
    ['wrong chart namespace', zip => changeXml(zip, 'ppt/charts/chart1.xml', xml => xml.replaceAll('http://schemas.openxmlformats.org/drawingml/2006/chart', 'urn:not-a-chart'))],
    ['spoofed relationship namespace', zip => changeXml(zip, 'ppt/charts/_rels/chart1.xml.rels', xml => xml.replace(PR, 'urn:not-relationships'))],
    ['duplicate content type declaration', zip => changeXml(zip, '[Content_Types].xml', xml => xml.replace('</Types>', '<Default Extension="xlsx" ContentType="application/xml"/></Types>'))],
    ['second non-chart incoming edge', zip => extraRelationship(zip, 'ppt/slides/_rels/slide1.xml.rels', `${R}/package`, `../embeddings/${embeddedName(zip).split('/').pop()}`)],
    ['duplicate relationship ID', zip => changeXml(zip, 'ppt/charts/_rels/chart1.xml.rels', xml => xml.replace('</Relationships>', `${xml.match(/<Relationship\s[^>]*\/>/)![0]}</Relationships>`))],
    ['arbitrary binary embedding', zip => zip.addFile('ppt/embeddings/object.bin', Buffer.from('not a workbook'))],
    ['unrelated XLSX embedding', zip => zip.addFile('ppt/embeddings/unrelated.xlsx', zip.getEntry(embeddedName(zip))!.getData())],
    ['workbook moved outside embeddings', zip => {
      const name = embeddedName(zip), bytes = zip.getEntry(name)!.getData();
      zip.deleteFile(name); zip.addFile('ppt/chart-data.xlsx', bytes);
      changeXml(zip, 'ppt/charts/_rels/chart1.xml.rels', xml => xml.replace(/Target="[^"]+"/, 'Target="../chart-data.xlsx"'));
    }],
    ['archive disguised as media', zip => zip.addFile('ppt/media/chart-data.bin', zip.getEntry(embeddedName(zip))!.getData())],
    ['arbitrary package relationship', zip => {
      zip.addFile('ppt/media/object.bin', Buffer.from('arbitrary object'));
      extraRelationship(zip, 'ppt/slides/_rels/slide1.xml.rels', `${R}/package`, '../media/object.bin');
    }],
    ['malformed embedded ZIP', zip => zip.updateFile(embeddedName(zip), Buffer.from('PK\x03\x04broken'))],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    await assert.rejects(inspect(await mutateOuter(change), 'pptx'), unsafe);
  });
  const workbook = new AdmZip();
  workbook.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
  workbook.addFile('xl/workbook.xml', Buffer.from('<workbook/>'));
  workbook.addFile('xl/embeddings/data.xlsx', Buffer.from(await chartDeck()));
  await assert.rejects(inspect(workbook.toBuffer(), 'xlsx'), unsafe);
});

test('nested chart workbooks reject active content, external resources, formulas and invalid OOXML', async t => {
  const cases: [string, (zip: AdmZip) => void][] = [
    ['VBA', zip => zip.addFile('xl/vbaProject.bin', Buffer.from('macro'))],
    ['ActiveX', zip => zip.addFile('xl/activeX/activeX1.bin', Buffer.from('control'))],
    ['nested archive/depth', zip => zip.addFile('xl/embeddings/deeper.xlsx', zip.toBuffer())],
    ['disguised binary', zip => zip.addFile('xl/worksheets/hidden.xml', Buffer.from('PK\x03\x04not XML'))],
    ['arbitrary non-XML part', zip => zip.addFile('xl/media/image.png', Buffer.from('image'))],
    ['external links', zip => zip.addFile('xl/externalLinks/externalLink1.xml', Buffer.from('<externalLink/>'))],
    ['connections', zip => zip.addFile('xl/connections.xml', Buffer.from('<connections/>'))],
    ['OLE XML', zip => appendWorksheet(zip, '<oleObjects/>')],
    ['DDE XML', zip => appendWorksheet(zip, '<ddeLink/>')],
    ['worksheet extensions', zip => appendWorksheet(zip, '<extLst/>')],
    ['non-passive theme extension', zip => changeXml(zip, 'xl/theme/theme1.xml', xml => xml.replace('<a:extLst>', '<a:extLst><a:unknown/>'))],
    ['DTD', zip => changeXml(zip, 'xl/worksheets/sheet1.xml', xml => xml.replace(/(<\?xml[^>]*\?>)/, '$1<!DOCTYPE worksheet [<!ENTITY x "y">]>'))],
    ['malformed XML', zip => appendWorksheet(zip, '<invalid>')],
    ['XML depth limit', zip => appendWorksheet(zip, '<x>'.repeat(129) + '</x>'.repeat(129))],
    ['wrong workbook content type', zip => changeXml(zip, '[Content_Types].xml', xml => xml.replace('spreadsheetml.sheet.main+xml', 'spreadsheetml.template.main+xml'))],
    ['macro content type', zip => changeXml(zip, '[Content_Types].xml', xml => xml.replace('spreadsheetml.sheet.main+xml', 'ms-excel.sheet.macroEnabled.main+xml'))],
    ['wrong workbook namespace', zip => changeXml(zip, 'xl/workbook.xml', xml => xml.replaceAll(S, 'urn:fake'))],
    ['root workbook relationship missing', zip => zip.deleteFile('_rels/.rels')],
    ['worksheet missing', zip => zip.deleteFile('xl/worksheets/sheet1.xml')],
    ['wrong worksheet relationship type', zip => changeXml(zip, 'xl/_rels/workbook.xml.rels', xml => xml.replace(`${R}/worksheet`, `${R}/styles`))],
    ['dangling sheet reference', zip => changeXml(zip, 'xl/workbook.xml', xml => xml.replace(/r:id="[^"]+"/, 'r:id="missing"'))],
    ['encoded external relationship', zip => extraRelationship(zip, 'xl/_rels/workbook.xml.rels', `${R}/hyperlink`, 'https:&#47;&#47;example.com')],
    ['file relationship', zip => extraRelationship(zip, 'xl/_rels/workbook.xml.rels', `${R}/hyperlink`, 'file:///etc/passwd')],
    ['internal hyperlink capability', zip => extraRelationship(zip, 'xl/_rels/workbook.xml.rels', `${R}/hyperlink`, 'worksheets/sheet1.xml')],
    ['unknown XML part', zip => zip.addFile('xl/custom.xml', Buffer.from('<custom/>'))],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    await assert.rejects(inspect(await mutateWorkbook(change), 'pptx'), unsafe);
  });
  for (const formula of ['DDE("cmd")', 'WEBSERVICE("https://example.com")', 'HYPERLINK("file:///etc/passwd")',
    'RTD("server")', 'cmd|arg!A1', '[other.xlsx]Sheet1!A1', '_xlfn.CALL("library")', 'EXEC("cmd")', 'REGISTER.ID("x")',
    'RUN("macro")', 'FOPEN("file")', '_x0057_EBSERVICE("https://example.com")']) {
    await t.test(`blocked formula ${formula.split('(')[0]}`, async () => {
      await assert.rejects(inspect(await mutateWorkbook(zip => appendWorksheet(zip,
        `<c><f>${formula}</f></c>`)), 'pptx'), unsafe);
    });
  }
  await t.test('formula CDATA/entity decoding', async () => {
    await assert.rejects(inspect(await mutateWorkbook(zip => appendWorksheet(zip,
      '<c><f>WEBSER<![CDATA[VICE]]>(&quot;https://example.com&quot;)</f></c>')), 'pptx'), unsafe);
  });
  await t.test('defined name execution', async () => {
    await assert.rejects(inspect(await mutateWorkbook(zip => changeXml(zip, 'xl/workbook.xml', xml =>
      xml.replace('</workbook>', '<definedNames><definedName name="bad">EXEC("cmd")</definedName></definedNames></workbook>'))), 'pptx'), unsafe);
  });
  await t.test('table formula execution', async () => {
    await assert.rejects(inspect(await mutateWorkbook(zip => changeXml(zip, 'xl/tables/table1.xml', xml =>
      xml.replace('</table>', '<calculatedColumnFormula>WEBSERVICE("https://example.com")</calculatedColumnFormula></table>'))), 'pptx'), unsafe);
  });
});

// Raw metadata mutation is necessary because archive writers sanitize paths and
// collapse exact duplicate names. Keep local and central names consistent here.
function renameRaw(bytes: Buffer, old: string, next: string) {
  assert.equal(Buffer.byteLength(old), Buffer.byteLength(next));
  const result = Buffer.from(bytes);
  let count = 0;
  const entry = new AdmZip(bytes).getEntry(old);
  assert.ok(entry);
  result.write(next, entry.header.offset + 30); count++;
  for (let offset = 0; offset < result.length - 46; offset++) {
    if (result.readUInt32LE(offset) !== 0x02014b50) continue;
    const length = result.readUInt16LE(offset + 28);
    if (result.subarray(offset + 46, offset + 46 + length).toString() === old) {
      result.write(next, offset + 46); count++;
    }
  }
  assert.equal(count, 2);
  return result;
}
test('nested ZIP rejects unsafe names, duplicate aliases, encryption and local/central disagreement', async t => {
  const outer = new AdmZip(await chartDeck());
  const original = outer.getEntry(embeddedName(outer))!.getData();
  const variants: [string, Buffer][] = [
    ['parent traversal', renameRaw(original, 'xl/styles.xml', '../styles.xml')],
    ['absolute path', renameRaw(original, 'xl/styles.xml', '/l/styles.xml')],
    ['backslash path', renameRaw(original, 'xl/styles.xml', 'xl\\styles.xml')],
  ];
  const duplicates = new AdmZip(original);
  duplicates.addFile('xl/styleZ.xml', Buffer.from('<styleSheet/>'));
  variants.push(['exact duplicate', renameRaw(duplicates.toBuffer(), 'xl/styleZ.xml', 'xl/styles.xml')]);
  const aliases = new AdmZip(original);
  aliases.addFile('xl/WORKBOOK.xml', Buffer.from('<workbook/>'));
  variants.push(['case alias duplicate', aliases.toBuffer()]);
  const localMismatch = Buffer.from(original);
  const entry = new AdmZip(original).getEntry('xl/styles.xml')!;
  localMismatch[entry.header.offset + 30] = 'z'.charCodeAt(0);
  variants.push(['local name mismatch', localMismatch]);
  const encrypted = Buffer.from(original);
  for (let i = 0; i < encrypted.length - 46; i++) {
    if (encrypted.readUInt32LE(i) === 0x02014b50) encrypted.writeUInt16LE(encrypted.readUInt16LE(i + 8) | 1, i + 8);
  }
  variants.push(['encryption flag', encrypted]);
  const badCrc = Buffer.from(original);
  badCrc.writeUInt32LE((badCrc.readUInt32LE(entry.header.offset + 14) ^ 1) >>> 0, entry.header.offset + 14);
  variants.push(['local CRC disagreement', badCrc]);
  for (const [name, bytes] of variants) await t.test(name, async () => {
    await assert.rejects(inspect(await mutateOuter(zip => zip.updateFile(embeddedName(zip), bytes)), 'pptx'), unsafe);
  });
});

test('nested and outer packages share entry and expanded-byte limits', async t => {
  await t.test('nested expansion ratio', async () => {
    await assert.rejects(inspect(await mutateWorkbook(zip => appendWorksheet(zip,
      `<padding>${'x'.repeat(2 * 1024 * 1024)}</padding>`)), 'pptx'), unsafe);
  });
  await t.test('aggregate entry count', async () => {
    const outer = new AdmZip(await chartDeck());
    const nested = new AdmZip(outer.getEntry(embeddedName(outer))!.getData());
    const count = 2001 - outer.getEntries().length - nested.getEntries().length;
    for (let n = 0; n < count; n++) outer.addFile(`budget/${n}/`, Buffer.alloc(0));
    assert.ok(outer.getEntries().length < 2000);
    await assert.rejects(inspect(outer.toBuffer(), 'pptx'), unsafe);
  });
  await t.test('nested per-entry expanded size', async () => {
    const seed = randomBytes(16 * 1024).toString('base64');
    const padding = (seed + 'x'.repeat(256 * 1024 - seed.length)).repeat(65);
    await assert.rejects(inspect(await mutateWorkbook(zip => appendWorksheet(zip,
      `<padding>${padding}</padding>`)), 'pptx'), unsafe);
  });
  await t.test('aggregate XML node budget', async () => {
    const outer = new AdmZip(await chartDeck());
    const name = embeddedName(outer);
    const nested = new AdmZip(outer.getEntry(name)!.getData());
    const nodes = (n: number) => Array.from({ length: n }, (_, i) => `<x v="${i}"/>`).join('');
    outer.addFile('padding.xml', Buffer.from(`<padding>${nodes(550000)}</padding>`));
    appendWorksheet(nested, `<padding>${nodes(500000)}</padding>`);
    outer.updateFile(name, nested.toBuffer());
    await assert.rejects(inspect(outer.toBuffer(), 'pptx'), unsafe);
  });
  await t.test('aggregate expanded bytes across workbook and parent', async () => {
    // Each individual entry is under 16 MiB and below the 100:1 ratio limit.
    // Each package alone expands below 80 MiB, but together they exceed it.
    const seed = randomBytes(16 * 1024).toString('base64');
    const padding = (seed + 'x'.repeat(256 * 1024 - seed.length)).repeat(32);
    const outer = new AdmZip(await chartDeck());
    const name = embeddedName(outer);
    const nested = new AdmZip(outer.getEntry(name)!.getData());
    for (let n = 0; n < 8; n++) outer.addFile(`padding${n}.xml`, Buffer.from(`<padding>${padding}</padding>`));
    appendWorksheet(nested, `<padding>${padding}</padding>`);
    changeXml(nested, 'xl/sharedStrings.xml', xml => xml.replace('</sst>', `<si><t>${padding}</t></si></sst>`));
    outer.updateFile(name, nested.toBuffer());
    const size = (zip: AdmZip) => zip.getEntries().reduce((n, e) => n + e.header.size, 0);
    assert.ok(size(outer) < 80 * 1024 * 1024);
    assert.ok(size(nested) < 80 * 1024 * 1024);
    assert.ok(size(outer) + size(nested) > 80 * 1024 * 1024);
    const bytes = outer.toBuffer();
    assert.ok(bytes.length < 20 * 1024 * 1024);
    const check = (zip: AdmZip) => {
      for (const e of zip.getEntries()) assert.ok(e.header.size <= Math.max(1024 * 1024, e.header.compressedSize * 100));
    };
    check(new AdmZip(bytes));
    check(new AdmZip(new AdmZip(bytes).getEntry(name)!.getData()));
    await assert.rejects(inspect(bytes, 'pptx'), unsafe);
  });
});
