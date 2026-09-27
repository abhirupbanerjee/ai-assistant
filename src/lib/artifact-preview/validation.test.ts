import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import { inspect } from './validation';
import { boundedBody, convert } from './provider';

async function pdf(pages: number, size: [number, number] = [612,792]) {
  const doc = new PDFDocument({autoFirstPage:false,compress:true}); const chunks: Buffer[] = [];
  const result = new Promise<Buffer>(resolve => { doc.on('data', c => chunks.push(c)); doc.on('end',() => resolve(Buffer.concat(chunks))); });
  for (let n=0;n<pages;n++) doc.addPage({size}).text('Safe fixture',20,20);
  doc.end(); return await result;
}
function zip(extra?: [string,string]) {
  const archive = new AdmZip(); archive.addFile('[Content_Types].xml',Buffer.from('<Types/>'));
  archive.addFile('xl/workbook.xml',Buffer.from('<workbook/>'));
  if(extra) archive.addFile(extra[0],Buffer.from(extra[1]));
  return archive.toBuffer();
}
test('PDF worker validates originals, rejects page/dimension limits and malformed input', async () => {
  assert.equal(await inspect(await pdf(2),'pdf'),2);
  await assert.rejects(inspect(await pdf(201),'pdf'));
  await assert.rejects(inspect(await pdf(1,[20000,20000]),'pdf'));
  await assert.rejects(inspect(Buffer.from('%PDF-junk'),'pdf'));
  await assert.rejects(inspect(Buffer.alloc(0),'pdf'));
});
test('OOXML worker bounds expansion and rejects active/external content', async () => {
  assert.equal(await inspect(zip(),'xlsx'),0);
  for (const extra of [['xl/vbaProject.bin','macro'],['xl/_rels/workbook.xml.rels','<Relationship TargetMode="External"/>'],['xl/big.xml','x'.repeat(2*1024*1024)]] as [string,string][]) await assert.rejects(inspect(zip(extra),'xlsx'));
  await assert.rejects(inspect(zip(),'pptx'));
  await assert.rejects(inspect(Buffer.from('legacy'),'xls'));
  const abort = new AbortController(); abort.abort(); await assert.rejects(inspect(zip(),'xlsx',abort.signal));
});
test('real Office generators accept ordinary text and standard HiddenSlides metadata', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Data').addRow(['Added revenue', 'Hidden costs', 'Ladder forecast', 'DDE is discussed here']);
  assert.equal(await inspect(Buffer.from(await workbook.xlsx.writeBuffer()), 'xlsx'), 0);
  const deck = new PptxGenJS();
  deck.addSlide().addText('Quarterly revenue — Added value', { x: 1, y: 1, w: 5, h: 1 });
  assert.equal(await inspect(Buffer.from(await deck.write({ outputType: 'nodebuffer' }) as Buffer), 'pptx'), 0);
});
test('structural Office checks reject decoded external relationships and formula execution', async () => {
  for (const xml of [
    '<Relationships><Relationship TargetMode="Ext&#101;rnal" Target="https://example.com"/></Relationships>',
    '<Relationships><Relationship Target="file:///etc/passwd"/></Relationships>',
  ]) await assert.rejects(inspect(zip(['xl/_rels/workbook.xml.rels', xml]), 'xlsx'));
  for (const formula of ['DDE("cmd")', 'WEBSERVICE("https://example.com")', 'cmd|arg!A1', '[other.xlsx]Sheet1!A1']) {
    const xml = `<worksheet><c><f>${formula.replaceAll('&','&amp;')}</f></c></worksheet>`;
    await assert.rejects(inspect(zip(['xl/worksheets/sheet1.xml', xml]), 'xlsx'));
  }
  await assert.rejects(inspect(zip(['xl/worksheets/sheet1.xml', '<worksheet><ddeLink/></worksheet>']), 'xlsx'));
  assert.equal(await inspect(zip(['xl/worksheets/sheet1.xml', '<worksheet><c><f>SUM(A1:A2)</f></c></worksheet>']), 'xlsx'), 0);
});
test('provider uses byte multipart only, no redirects, and bounded result', async () => {
  const enabled=process.env.ARTIFACT_PREVIEW_ENABLED, url=process.env.ARTIFACT_GOTENBERG_URL;
  process.env.ARTIFACT_PREVIEW_ENABLED='true'; process.env.ARTIFACT_GOTENBERG_URL='http://gotenberg:3000';
  try {
    let calls=0;
    const fetcher: typeof fetch = async (url, options) => {
      calls++; assert.equal(url,'http://gotenberg:3000/forms/libreoffice/convert'); assert.equal(options?.redirect,'error');
      assert.ok(options?.body instanceof FormData); assert.equal(options.body.has('url'),false);
      return new Response('%PDF-test',{headers:{'content-type':'application/pdf'}});
    };
    assert.equal((await convert(Buffer.from('input'),'xlsx',new AbortController().signal,fetcher)).toString(),'%PDF-test'); assert.equal(calls,1);
    await assert.rejects(convert(Buffer.from('input'),'xlsx',new AbortController().signal,async()=>new Response('secret provider error',{status:500})),error=>error instanceof Error && !error.message.includes('secret'));
    await assert.rejects(boundedBody(new Response('123456'),3));
    await assert.rejects(boundedBody(new Response('x',{headers:{'content-length':'999'}}),3));
  } finally {
    if(enabled===undefined) delete process.env.ARTIFACT_PREVIEW_ENABLED; else process.env.ARTIFACT_PREVIEW_ENABLED=enabled;
    if(url===undefined) delete process.env.ARTIFACT_GOTENBERG_URL; else process.env.ARTIFACT_GOTENBERG_URL=url;
  }
});
