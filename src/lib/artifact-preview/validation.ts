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
    const entries = new Zip(bytes).getEntries();
    if (entries.length > 2000) throw Error();
    let total = 0; const names = new Set();
    for (const e of entries) {
      const name = e.entryName;
      if (names.has(name) || name.includes('..') || name.startsWith('/') || name.includes('\\') || e.header.flags & 1) throw Error();
      names.add(name);
      if (e.isDirectory) continue;
      total += e.header.size;
      if (total > 80*1024*1024 || e.header.size > 16*1024*1024 || e.header.size > Math.max(1024*1024,e.header.compressedSize*100)) throw Error();
      if (/vba|activex|embeddings|externallinks|connections\.xml|customui/i.test(name)) throw Error();
      const compressed = e.getCompressedData();
      const data = e.header.method === 0 ? compressed : e.header.method === 8 ? inflateRawSync(compressed, {maxOutputLength: 16*1024*1024}) : null;
      if (!data || data.length !== e.header.size) throw Error();
      if (/\.(xml|rels)$/i.test(name)) {
        const xml = data.toString('utf8');
        if (xml.includes('\u0000')) throw Error();
        const parser = new SaxesParser({xmlns:true});
        const stack = [];
        let formula = '';
        const forbidden = new Set(['ddelink','ddeitem','ddeitems','oleobject','oleobjects','externalreference','externalreferences']);
        parser.on('doctype', () => { throw Error(); });
        parser.on('error', () => { throw Error(); });
        parser.on('opentag', tag => {
          const local = tag.local.toLowerCase();
          if (forbidden.has(local)) throw Error();
          stack.push(local);
          if (local === 'f') formula = '';
          for (const attr of Object.values(tag.attributes)) {
            const key = attr.local.toLowerCase(), value = attr.value.trim();
            if ((local === 'relationship' && key === 'targetmode' && value.toLowerCase() === 'external') ||
                (key === 'contenttype' && /macroenabled|vbaproject|activex|oleobject/i.test(value)) ||
                (local === 'relationship' && key === 'target' && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value))) throw Error();
          }
        });
        parser.on('text', text => { if (stack.at(-1) === 'f') formula += text; });
        parser.on('cdata', text => { if (stack.at(-1) === 'f') formula += text; });
        parser.on('closetag', tag => {
          if (tag.local.toLowerCase() === 'f' && /(?:^|[^a-z0-9_])(?:_xlfn\.)?(?:DDE|WEBSERVICE|HYPERLINK|RTD)\s*\(|\||\[[^\]]+\]/i.test(formula)) throw Error();
          stack.pop();
        });
        parser.write(xml).close();
      }
    }
    const main = workerData.format === 'pptx' ? 'ppt/presentation.xml' : 'xl/workbook.xml';
    if (!names.has('[Content_Types].xml') || !names.has(main)) throw Error();
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
