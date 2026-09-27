'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import type { ArtifactComment, ArtifactCanvasItem, ArtifactPreviewReady } from '@/types/artifact-canvas';
import { artifactEndpoint, artifactJson } from '@/lib/artifact-preview-client';

export function useArtifactComments(artifact: ArtifactCanvasItem, preview?: ArtifactPreviewReady) {
  const endpoint = artifactEndpoint(artifact);
  const [comments, setComments] = useState<ArtifactComment[]>([]);
  const [sourceVersion, setSourceVersion] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const pending = useRef<{ payload: string; token: string } | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setComments([]); setSourceVersion(undefined); setError(undefined); pending.current = null;
    if (endpoint) {
      setLoading(true);
      artifactJson<{sourceVersion:string;comments:ArtifactComment[]}>(endpoint,{signal:controller.signal})
        .then(data=>{if(current===generation.current){setSourceVersion(data.sourceVersion);setComments(data.comments);}})
        .catch(e=>{if(!controller.signal.aborted && current===generation.current)setError(e.message);})
        .finally(()=>{if(current===generation.current)setLoading(false);});
    }
    return ()=>{generation.current++;controller.abort();};
  },[endpoint,artifact.artifactId]);

  const save = useCallback(async (data: {commentText:string;selectedText?:string;surroundingContext?:string;pageNumber?:number}) => {
    if(busy.current) return false;
    const current=generation.current;
    busy.current=true;setSaving(true);setError(undefined);
    try {
      let comment: ArtifactComment;
      if(endpoint){
        if(!sourceVersion)throw new Error('Wait for comments to load, or reopen this artifact.');
        const isAnchored = Boolean(data.selectedText || data.pageNumber !== undefined);
        const payload = {
          ...data,
          sourceVersion,
          renderVersion: isAnchored ? preview?.renderVersion : undefined,
          pageNumber: data.pageNumber,
        };
        const encoded=JSON.stringify(payload);
        if(pending.current?.payload!==encoded)pending.current={payload:encoded,token:crypto.randomUUID()};
        const result=await artifactJson<{comment:ArtifactComment}>(`${endpoint}/comments`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,clientToken:pending.current.token})});
        comment=result.comment;
      } else {
        comment={...data,commentId:crypto.randomUUID(),artifactId:artifact.artifactId,artifactType:artifact.artifactType,artifactTitle:artifact.title,createdAt:Date.now(),
          imageUrl:artifact.artifactType==='image'?artifact.downloadUrl:undefined};
      }
      if(current!==generation.current)return false;
      setComments(prev=>prev.some(c=>c.commentId===comment.commentId)?prev:[...prev,comment]);pending.current=null;return true;
    } catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'Comment could not be saved.');return false;}
    finally{busy.current=false;if(current===generation.current)setSaving(false);}
  },[endpoint,sourceVersion,preview,artifact]);
  const removeComment=useCallback(async(commentId:string)=>{
    const current=generation.current;
    try{
      if(endpoint){if(!sourceVersion)return;await artifactJson(`${endpoint}/comments?version=${sourceVersion}&commentId=${encodeURIComponent(commentId)}`,{method:'DELETE'});}
      if(current===generation.current)setComments(prev=>prev.filter(c=>c.commentId!==commentId));
    }catch(e){if(current===generation.current)setError(e instanceof Error?e.message:'Comment could not be deleted.');}
  },[endpoint,sourceVersion]);
  return {comments,addTextComment:save,addImageComment:save,removeComment,commentCount:comments.length,error,loading,saving,sourceVersion};
}
