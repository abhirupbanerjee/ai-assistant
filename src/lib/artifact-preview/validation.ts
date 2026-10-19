import { Worker } from 'node:worker_threads';
import { PreviewError, INPUT_LIMIT, OUTPUT_LIMIT } from './policy';

// Evaluated in a disposable worker: parser CPU hangs cannot block the web event
// loop. Module paths are resolved by the server, never supplied by a request.
const inspectionWorker = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
// Resolve inside the actual Node worker, never in the Next/Turbopack bundle.
const runtimeRequire = createRequire(workerData.moduleBase);
const { inflateRawSync } = require('node:zlib');
(async () => {
  const bytes = Buffer.from(workerData.bytes);
  if (workerData.format !== 'pdf') {
    const Zip = runtimeRequire('adm-zip');
    const { SaxesParser } = runtimeRequire('saxes');
    const path = require('node:path').posix;
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
    const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
    const MIME = 'application/vnd.openxmlformats-officedocument.';
    // One shared budget, including compressed workbook bytes in the parent AND
    // their expanded contents. A workbook cannot reset any resource allowance.
    const budget = { entries: 0, bytes: 0, nodes: 0 };
    const crcTable = Array.from({length:256}, (_, n) => {
      for (let k=0;k<8;k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
      return n >>> 0;
    });
    const crc32 = data => {
      let crc = 0xffffffff;
      for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      return (crc ^ 0xffffffff) >>> 0;
    };
    const safeName = name => name && !/[\\\x00-\x20\x7f%?#:]/.test(name) && !name.includes('..') && !name.startsWith('/') &&
      !name.split('/').some(p => p === '.' || p === '..' || p === '');
    const targetPart = (source, target) => {
      if (!target || /[\\\x00-\x20\x7f%?#:]/.test(target) || target.startsWith('//')) throw Error();
      // OPC permits package-absolute targets and parent references, but never
      // traversal above the package root, URI encodings, fragments or schemes.
      const segments = (target.startsWith('/') ? target.slice(1) : path.join(path.dirname(source), target)).split('/');
      const resolved = path.normalize(segments.join('/'));
      if (!safeName(resolved)) throw Error();
      return resolved;
    };
    function readPackage(input, depth) {
      if (depth > 1 || input.readUInt32LE(0) !== 0x04034b50) throw Error();
      const entries = new Zip(input).getEntries();
      budget.entries += entries.length;
      if (budget.entries > 2000) throw Error();
      const parts = new Map(), names = new Set(), defaults = new Map(), overrides = new Map();
      for (const e of entries) {
        const name = e.entryName;
        const canonical = (e.isDirectory ? name.replace(/\/$/, '') : name).toLowerCase();
        if (names.has(canonical) || !safeName(e.isDirectory ? name.replace(/\/$/, '') : name) || e.header.flags & 0x2041) throw Error();
        names.add(canonical);
        // Do not let the converter interpret a different local ZIP filename,
        // encryption flag or compression method than the central directory.
        const offset = e.header.offset;
        if (input.readUInt32LE(offset) !== 0x04034b50 || input.readUInt16LE(offset+6) !== e.header.flags ||
            input.readUInt16LE(offset+8) !== e.header.method ||
            !input.subarray(offset+30, offset+30+input.readUInt16LE(offset+26)).equals(e.rawEntryName)) throw Error();
        if (!(e.header.flags & 8) && (input.readUInt32LE(offset+14) !== e.header.crc ||
            input.readUInt32LE(offset+18) !== e.header.compressedSize || input.readUInt32LE(offset+22) !== e.header.size)) throw Error();
        if (e.isDirectory) continue;
        budget.bytes += e.header.size;
        if (budget.bytes > 80*1024*1024 || e.header.size > 16*1024*1024 || e.header.size > Math.max(1024*1024,e.header.compressedSize*100)) throw Error();
        const embedded = depth === 0 && workerData.format === 'pptx' && /^ppt\/embeddings\/[^/]+\.xlsx$/.test(name);
        if (/vba|activex|externallinks|connections\.xml|customui/i.test(name) || (/embeddings/i.test(name) && !embedded)) throw Error();
        const compressed = e.getCompressedData();
        const data = e.header.method === 0 ? compressed : e.header.method === 8 ? inflateRawSync(compressed, {maxOutputLength: 16*1024*1024}) : null;
        if (!data || compressed.length !== e.header.compressedSize || data.length !== e.header.size || crc32(data) !== e.header.crc) throw Error();
        // Moving an archive out of embeddings or renaming it as media must not
        // bypass nested inspection. Only graph-approved chart XLSX is eligible.
        if (!embedded && data.length >= 4 && [0x04034b50,0x06054b50,0x08074b50].includes(data.readUInt32LE(0))) throw Error();
        const part = { name, embedded, data: embedded ? data : undefined, rels: [], refs: [], root: null };
        parts.set(name, part);
        if (/\.(xml|rels)$/i.test(name)) {
          const xml = new TextDecoder('utf-8', {fatal:true}).decode(data);
          if (xml.includes('\u0000')) throw Error();
          const parser = new SaxesParser({xmlns:true});
          const stack = [];
          let formula = '';
          const forbidden = new Set(['ddelink','ddeitem','ddeitems','oleobject','oleobjects','externalreference','externalreferences',
            'control','controls','legacydrawing','legacydrawinghf','attachedtemplate']);
          parser.on('doctype', () => { throw Error(); });
          parser.on('error', () => { throw Error(); });
          parser.on('processinginstruction', () => { throw Error(); });
          parser.on('opentag', tag => {
            const local = tag.local.toLowerCase();
            if (['f','definedname','calculatedcolumnformula','totalsrowformula'].includes(stack.at(-1))) throw Error();
            if (++budget.nodes > 1000000 || stack.length >= 128 || forbidden.has(local) ||
                (depth && (local === 'alternatecontent' || (local === 'extlst' && name !== 'xl/styles.xml' && !/^xl\/theme\/[^/]+\.xml$/.test(name))))) throw Error();
            if (depth && (local === 'extlst' || stack.includes('extlst'))) {
              // Only passive theme-family / default style metadata emitted by
              // PptxGenJS and ExcelJS; no general-purpose extension allowance.
              const allowed = name === 'xl/styles.xml' ? [
                [S, 'extLst'], [S, 'ext'],
                ['http://schemas.microsoft.com/office/spreadsheetml/2009/9/main', 'slicerStyles'],
                ['http://schemas.microsoft.com/office/spreadsheetml/2010/11/main', 'timelineStyles'],
              ] : [
                ['http://schemas.openxmlformats.org/drawingml/2006/main', 'extLst'],
                ['http://schemas.openxmlformats.org/drawingml/2006/main', 'ext'],
                ['http://schemas.microsoft.com/office/thememl/2012/main', 'themeFamily'],
              ];
              if (!allowed.some(([uri, name]) => tag.uri === uri && tag.local === name)) throw Error();
            }
            if (!part.root) part.root = { local: tag.local, uri: tag.uri };
            stack.push(local);
            if (['f','definedname','calculatedcolumnformula','totalsrowformula'].includes(local)) formula = '';
            for (const attr of Object.values(tag.attributes)) {
              const key = attr.local.toLowerCase(), value = attr.value.trim();
              if ((local === 'relationship' && key === 'targetmode' && value.toLowerCase() === 'external') ||
                  (key === 'contenttype' && /macroenabled|vbaproject|activex|oleobject/i.test(value)) ||
                  (local === 'relationship' && key === 'target' && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value))) throw Error();
              if (attr.uri === R && key === 'id') part.refs.push({ local: tag.local, uri: tag.uri, id: value });
            }
            const attr = key => tag.attributes[key]?.value;
            if (local === 'relationship') {
              if (tag.uri !== PR || stack.length !== 2 || part.root.local !== 'Relationships' || part.root.uri !== PR) throw Error();
              const id = attr('Id'), type = attr('Type'), target = attr('Target'), mode = attr('TargetMode');
              if (!id || !type || !target || (mode && mode !== 'Internal') || part.rels.some(r => r.id === id) ||
                  /vba|activex|oleobject|externalLink|connections|attachedTemplate|control|customui/i.test(type)) throw Error();
              part.rels.push({ id, type, target });
            }
            if (name === '[Content_Types].xml' && stack.length > 1) {
              if (tag.uri !== CT || stack.length !== 2 || !['Default','Override'].includes(tag.local)) throw Error();
              const key = attr(tag.local === 'Default' ? 'Extension' : 'PartName');
              const type = attr('ContentType'), map = tag.local === 'Default' ? defaults : overrides;
              if (!key || !type || map.has(key.toLowerCase())) throw Error();
              map.set(key.toLowerCase(), type);
            }
          });
          const formulaTags = ['f','definedname','calculatedcolumnformula','totalsrowformula'];
          const passiveFunctions = new Set(['SUM','AVERAGE','MIN','MAX','COUNT','COUNTA','COUNTBLANK','COUNTIF','COUNTIFS',
            'SUMIF','SUMIFS','AVERAGEIF','AVERAGEIFS','IF','IFERROR','IFNA','AND','OR','NOT','ABS','ROUND','ROUNDUP',
            'ROUNDDOWN','INT','MOD','SQRT','POWER','SUBTOTAL','PRODUCT','SUMPRODUCT','MEDIAN','STDEV','STDEV.S',
            'STDEV.P','VAR','VAR.S','VAR.P','ROWS','COLUMNS','ROW','COLUMN','INDEX','MATCH','VLOOKUP','HLOOKUP',
            'CHOOSE','ISBLANK','ISNUMBER','ISTEXT','ISERROR','TRUE','FALSE','NA','DATE','YEAR','MONTH','DAY']);
          parser.on('text', text => { if (formulaTags.includes(stack.at(-1))) formula += text; });
          parser.on('cdata', text => { if (formulaTags.includes(stack.at(-1))) formula += text; });
          parser.on('closetag', tag => {
            if (formulaTags.includes(tag.local.toLowerCase())) {
              const decoded = formula.replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex,16)));
              if (/(?:^|[^a-z0-9_])(?:_xlfn\.)?(?:DDE|WEBSERVICE|HYPERLINK|RTD|CALL|REGISTER(?:\.ID)?|EXEC|EVALUATE|SQL\.REQUEST)\s*\(|\||\[[^\]]+\]/i.test(decoded)) throw Error();
              if (depth && (/\\|:\/\//.test(decoded) || [...decoded.matchAll(/([a-z_][a-z0-9_.]*)\s*\(/gi)]
                  .some(match => !passiveFunctions.has(match[1].toUpperCase())))) throw Error();
            }
            stack.pop();
          });
          parser.write(xml).close();
        } else if (depth) throw Error(); // Nested workbooks are XML-only; no binaries or further archives.
      }
      const main = depth || workerData.format === 'xlsx' ? 'xl/workbook.xml' : 'ppt/presentation.xml';
      if (!parts.has('[Content_Types].xml') || !parts.has(main)) throw Error();
      const typeOf = name => overrides.get('/' + name.toLowerCase()) || defaults.get(name.split('.').pop().toLowerCase());
      const relationships = [];
      for (const part of parts.values()) {
        if (!part.name.endsWith('.rels')) { if (part.rels.length) throw Error(); continue; }
        const source = part.name === '_rels/.rels' ? '' : part.name.replace(/(^|\/)\_rels\/([^/]+)\.rels$/, '$1$2');
        if (source === part.name || (source && !parts.has(source))) throw Error();
        if (part.root?.local !== 'Relationships' || part.root.uri !== PR) throw Error();
        for (const rel of part.rels) relationships.push({ ...rel, source, target: targetPart(source, rel.target) });
      }
      return { parts, typeOf, relationships, main };
    }
    const rootIs = (pkg, name, uri, local) => {
      const root = pkg.parts.get(name)?.root;
      return root?.uri === uri && root.local === local;
    };
    const reference = (pkg, source, rel, uri, local) => pkg.parts.get(source)?.refs.some(r => r.id === rel.id && r.uri === uri && r.local === local);
    function typedPackage(pkg) {
      if (!rootIs(pkg, '[Content_Types].xml', CT, 'Types')) throw Error();
      for (const rel of pkg.relationships) if (!pkg.parts.has(rel.target)) throw Error();
    }
    function inspectWorkbook(input) {
      const pkg = readPackage(input, 1);
      typedPackage(pkg);
      // A small passive SpreadsheetML subset sufficient for editable chart data.
      // Paths, content types, roots AND allowed relationship edges must agree.
      const specs = [
        [/^xl\/workbook\.xml$/, MIME+'spreadsheetml.sheet.main+xml', S, 'workbook', R+'/officeDocument', ''],
        [/^xl\/worksheets\/[^/]+\.xml$/, MIME+'spreadsheetml.worksheet+xml', S, 'worksheet', R+'/worksheet', 'xl/workbook.xml'],
        [/^xl\/styles\.xml$/, MIME+'spreadsheetml.styles+xml', S, 'styleSheet', R+'/styles', 'xl/workbook.xml'],
        [/^xl\/sharedStrings\.xml$/, MIME+'spreadsheetml.sharedStrings+xml', S, 'sst', R+'/sharedStrings', 'xl/workbook.xml'],
        [/^xl\/theme\/[^/]+\.xml$/, MIME+'theme+xml', 'http://schemas.openxmlformats.org/drawingml/2006/main', 'theme', R+'/theme', 'xl/workbook.xml'],
        [/^xl\/tables\/[^/]+\.xml$/, MIME+'spreadsheetml.table+xml', S, 'table', R+'/table', /^xl\/worksheets\/[^/]+\.xml$/],
        [/^docProps\/core\.xml$/, 'application/vnd.openxmlformats-package.core-properties+xml', 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties', 'coreProperties', PR+'/metadata/core-properties', ''],
        [/^docProps\/app\.xml$/, MIME+'extended-properties+xml', 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties', 'Properties', R+'/extended-properties', ''],
      ];
      for (const part of pkg.parts.values()) {
        if (part.name === '[Content_Types].xml') continue;
        if (part.name.endsWith('.rels')) {
          if (pkg.typeOf(part.name) !== 'application/vnd.openxmlformats-package.relationships+xml') throw Error();
          continue;
        }
        const spec = specs.find(s => s[0].test(part.name));
        if (!spec || pkg.typeOf(part.name) !== spec[1] || !rootIs(pkg, part.name, spec[2], spec[3])) throw Error();
        const incoming = pkg.relationships.filter(r => r.target === part.name);
        if (!incoming.length || incoming.some(r => r.type !== spec[4] ||
            (typeof spec[5] === 'string' ? r.source !== spec[5] : !spec[5].test(r.source)))) throw Error();
        if (spec[3] === 'worksheet' && incoming.some(r => !reference(pkg, r.source, r, S, 'sheet'))) throw Error();
        // PptxGenJS emits a passive table relationship without tablePart markup.
        // Its target still has to match the table path/type/root specification.
      }
      for (const part of pkg.parts.values()) for (const ref of part.refs) {
        const type = ref.uri === S && ref.local === 'sheet' ? R+'/worksheet' : ref.uri === S && ref.local === 'tablePart' ? R+'/table' : null;
        if (!type || !pkg.relationships.some(r => r.source === part.name && r.id === ref.id && r.type === type)) throw Error();
      }
      if (!pkg.relationships.some(r => r.source === '' && r.target === pkg.main && r.type === R+'/officeDocument') ||
          !pkg.relationships.some(r => r.source === pkg.main && r.type === R+'/worksheet')) throw Error();
    }
    const pkg = readPackage(bytes, 0);
    for (const rel of pkg.relationships) {
      if (/\/package$/i.test(rel.type) && (rel.type !== R+'/package' || !pkg.parts.get(rel.target)?.embedded)) throw Error();
    }
    const embedded = [...pkg.parts.values()].filter(p => p.embedded);
    if (embedded.length) {
      typedPackage(pkg);
      if (pkg.typeOf(pkg.main) !== MIME+'presentationml.presentation.main+xml' || !rootIs(pkg, pkg.main, P, 'presentation') ||
          !pkg.relationships.some(r => r.source === '' && r.target === pkg.main && r.type === R+'/officeDocument')) throw Error();
      const slides = new Set(pkg.relationships.filter(r => r.source === pkg.main && r.type === R+'/slide' &&
        reference(pkg, pkg.main, r, P, 'sldId') && pkg.typeOf(r.target) === MIME+'presentationml.slide+xml' && rootIs(pkg, r.target, P, 'sld')).map(r => r.target));
      const charts = new Set(pkg.relationships.filter(r => slides.has(r.source) && r.type === R+'/chart' &&
        reference(pkg, r.source, r, C, 'chart') && pkg.typeOf(r.target) === MIME+'drawingml.chart+xml' && rootIs(pkg, r.target, C, 'chartSpace')).map(r => r.target));
      for (const part of embedded) {
        if (pkg.typeOf(part.name) !== MIME+'spreadsheetml.sheet') throw Error();
        const incoming = pkg.relationships.filter(r => r.target === part.name);
        if (!incoming.length || incoming.some(r => !charts.has(r.source) || r.type !== R+'/package' || !reference(pkg, r.source, r, C, 'externalData'))) throw Error();
        inspectWorkbook(part.data);
      }
    }
    parentPort.postMessage({pages:0}); return;
  }
  const pdfjs = await import(pathToFileURL(runtimeRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  const task = pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,
    maxImageSize:16000000,stopAtErrors:true,verbosity:0});
  const doc = await task.promise;
  try {
    if (!doc.numPages || doc.numPages > 200 || await doc.getJSActions() || await doc.getAttachments()) throw Error();
    let totalOps = 0;
    for(let n=1;n<=doc.numPages;n++) {
      const page = await doc.getPage(n);
      const view = page.getViewport({scale:1});
      if (![view.width,view.height].every(x=>Number.isFinite(x)&&x>0&&x<=14400) || view.width*view.height>32000000) throw Error();
      const ops = await page.getOperatorList();
      totalOps += ops.fnArray.length;
      if (ops.fnArray.length>100000 || totalOps>1000000) throw Error();
      for (let i=0;i<ops.fnArray.length;i++) {
        const args=ops.argsArray[i];
        if (ops.fnArray[i]===pdfjs.OPS.paintImageXObject && args[1]*args[2]>16000000) throw Error();
        if (ops.fnArray[i]===pdfjs.OPS.paintInlineImageXObject && args[0].width*args[0].height>16000000) throw Error();
      }
      const annotations = await page.getAnnotations();
      if (annotations.length>1000 || annotations.some(a=>a.actions || a.file)) throw Error();
      page.cleanup();
    }
    parentPort.postMessage({pages:doc.numPages});
  } finally { await task.destroy(); }
})().catch(()=>parentPort.postMessage({error:true}));
`;

export async function inspect(bytes: Buffer, format: string, signal?: AbortSignal): Promise<number> {
  if (bytes.length > (format === 'pdf' ? OUTPUT_LIMIT : INPUT_LIMIT)) throw new PreviewError('INPUT_TOO_LARGE', 413);
  if (bytes.length < 5 || (format === 'pdf' ? !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) : !['pptx', 'xlsx'].includes(format) || bytes.readUInt32LE(0) !== 0x04034b50)) throw new PreviewError('UNSUPPORTED_FORMAT', 415);
  if (signal?.aborted) throw new PreviewError('REQUEST_CANCELLED', 499);
  return await new Promise<number>((resolve, reject) => {
    const worker = new Worker(inspectionWorker, { eval: true,
      workerData: { bytes, format, moduleBase: `${process.cwd()}/package.json` },
      resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } });
    const end = (error?: PreviewError, pages = 0) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(pages);
    };
    const abort = () => end(new PreviewError('REQUEST_CANCELLED', 499));
    const timer = setTimeout(() => end(new PreviewError('VALIDATION_LIMIT', 422)), 10_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', result => end(result.error ? new PreviewError('UNSAFE_OR_INVALID_DOCUMENT', 422) : undefined, result.pages));
    worker.once('error', () => end(new PreviewError('UNSAFE_OR_INVALID_DOCUMENT', 422)));
    worker.once('exit', code => { if (code !== 0) end(new PreviewError('VALIDATION_LIMIT', 422)); });
  });
}
