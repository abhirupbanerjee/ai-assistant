'use client';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask, TextLayer } from 'pdfjs-dist';
import type { ArtifactCanvasItem, ArtifactPreviewReady } from '@/types/artifact-canvas';
import { artifactEndpoint, artifactJson } from '@/lib/artifact-preview-client';
import './pdf-preview.css';

interface Props {
  artifact: ArtifactCanvasItem;
  onReady?: (preview: ArtifactPreviewReady) => void;
  onPage?: (page: number) => void;
}
export default function PdfViewer({artifact,onReady,onPage}:Props){
  const [preview,setPreview]=useState<ArtifactPreviewReady>();
  const [document,setDocument]=useState<PDFDocumentProxy>();
  const [page,setPage]=useState(1),[zoom,setZoom]=useState(1),[width,setWidth]=useState(600);
  const [attempt,setAttempt]=useState(0),[error,setError]=useState<string>(),[busy,setBusy]=useState(true),[textless,setTextless]=useState(false);
  const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),text=useRef<HTMLDivElement>(null),sheet=useRef<HTMLDivElement>(null);
  const readyCallback=useRef(onReady),pageCallback=useRef(onPage);
  readyCallback.current=onReady;pageCallback.current=onPage;
  useEffect(()=>{const el=host.current;if(!el)return;const observer=new ResizeObserver(entries=>setWidth(Math.max(240,entries[0].contentRect.width-32)));observer.observe(el);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    const controller=new AbortController();let cancelled=false;let task:ReturnType<typeof import('pdfjs-dist')['getDocument']>|undefined;
    setBusy(true);setError(undefined);setPreview(undefined);setDocument(undefined);setPage(1);setZoom(1);
    void(async()=>{
      const endpoint=artifactEndpoint(artifact);if(!endpoint)throw new Error('This artifact has no supported private source identity.');
      const metadata=await artifactJson<{sourceVersion:string}>(endpoint,{signal:controller.signal});
      const result=await artifactJson<ArtifactPreviewReady>(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceVersion:metadata.sourceVersion}),signal:controller.signal});
      if(cancelled)return;
      const pdfjs=await import('pdfjs-dist');
      if(cancelled)return;
      pdfjs.GlobalWorkerOptions.workerSrc='/pdfjs/pdf.worker.min.mjs';
      task=pdfjs.getDocument({url:result.pdfUrl,withCredentials:true,isEvalSupported:false,disableRange:true,disableStream:true,
        cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'});
      const doc=await task.promise;
      if(cancelled){await doc.destroy();return;}
      setPreview(result);setDocument(doc);readyCallback.current?.(result);pageCallback.current?.(1);
    })().catch(e=>{if(!cancelled)setError(e.message||'Preview could not be loaded.');}).finally(()=>{if(!cancelled)setBusy(false);});
    return()=>{cancelled=true;controller.abort();void task?.destroy();};
  },[artifact.source?.kind,artifact.source?.id,artifact.artifactId,attempt]);
  useEffect(()=>{
    if(!document)return;let cancelled=false;let render:RenderTask|undefined;let layer:TextLayer|undefined;
    setBusy(true);setError(undefined);setTextless(false);
    void(async()=>{
      const pdfjs=await import('pdfjs-dist');const p=await document.getPage(page);
      if(cancelled||!canvas.current||!text.current||!sheet.current)return;
      const base=p.getViewport({scale:1});let scale=width/base.width*zoom;
      // Bound canvas dimensions and pixels even when an unusual PDF page passes
      // server validation. Zoom never allocates an unbounded bitmap.
      scale=Math.min(scale,4096/base.width,4096/base.height,Math.sqrt(8_000_000/(base.width*base.height)));
      const viewport=p.getViewport({scale});const el=canvas.current;
      el.width=Math.ceil(viewport.width);el.height=Math.ceil(viewport.height);
      sheet.current.style.width=`${viewport.width}px`;sheet.current.style.height=`${viewport.height}px`;
      sheet.current.style.setProperty('--scale-factor',String(scale));
      text.current.replaceChildren();
      render=p.render({canvas:el,viewport});await render.promise;
      if(cancelled)return;
      const content=await p.getTextContent();if(cancelled)return;
      setTextless(!content.items.some(item=>'str' in item&&item.str.trim()));
      layer=new pdfjs.TextLayer({textContentSource:content,container:text.current,viewport});await layer.render();
    })().catch(e=>{if(!cancelled&&e.name!=='RenderingCancelledException')setError('This page could not be rendered.');}).finally(()=>{if(!cancelled)setBusy(false);});
    return()=>{cancelled=true;render?.cancel();layer?.cancel();};
  },[document,page,zoom,width]);
  const navigate=(n:number)=>{window.getSelection()?.removeAllRanges();setPage(n);pageCallback.current?.(n);host.current?.scrollTo({top:0});};
  return <div className="h-full flex flex-col min-h-0">
    <div className="p-2 border-b flex flex-wrap items-center gap-2 text-sm" aria-label="PDF controls">
      <span>{preview?.converted?'Converted preview — original unchanged':'Original PDF'}</span>
      {document&&<>
        <button aria-label="Previous PDF page" disabled={page<=1} onClick={()=>navigate(page-1)}>Previous</button>
        <label>Page <input aria-label="PDF page number" className="w-14 border rounded" type="number" min={1} max={document.numPages} value={page} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=document.numPages)navigate(n);}}/> / {document.numPages}</label>
        <button aria-label="Next PDF page" disabled={page>=document.numPages} onClick={()=>navigate(page+1)}>Next</button>
        <button aria-label="Zoom out" disabled={zoom<=0.5} onClick={()=>setZoom(z=>Math.max(.5,z-.25))}>−</button>
        <button onClick={()=>setZoom(1)}>Fit width</button>
        <button aria-label="Zoom in" disabled={zoom>=2} onClick={()=>setZoom(z=>Math.min(2,z+.25))}>+</button>
      </>}
    </div>
    {busy&&<p role="status" className="p-2 text-sm">Preparing private preview…</p>}
    {error&&<div role="alert" className="p-4 text-sm text-red-700">{error} <button className="underline" onClick={()=>setAttempt(n=>n+1)}>Retry preview</button></div>}
    {textless&&<p className="p-2 text-xs">No selectable text on this page. General and page comments are available; OCR is not performed.</p>}
    <div ref={host} className="flex-1 min-h-0 overflow-auto bg-gray-100 p-4">
      <div ref={sheet} data-page-number={page} className="artifact-pdf-sheet relative mx-auto bg-white shadow" style={{display:document?'block':'none'}}>
        <canvas ref={canvas} aria-label={`PDF page ${page}`} role="img"/>
        <div ref={text} className="artifact-pdf-text"/>
      </div>
    </div>
  </div>;
}
