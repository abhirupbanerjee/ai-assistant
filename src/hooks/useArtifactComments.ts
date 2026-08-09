'use client';

import { useState, useCallback } from 'react';
import type { ArtifactComment, ArtifactCanvasItem } from '@/types';

export function useArtifactComments(artifact: ArtifactCanvasItem) {
  const [comments, setComments] = useState<ArtifactComment[]>([]);

  const addTextComment = useCallback((data: {
    selectedText: string;
    surroundingContext: string;
    commentText: string;
    pageNumber?: number;
  }) => {
    const comment: ArtifactComment = {
      commentId: crypto.randomUUID(),
      artifactId: artifact.artifactId,
      artifactType: artifact.artifactType,
      artifactTitle: artifact.title,
      commentText: data.commentText,
      selectedText: data.selectedText,
      surroundingContext: data.surroundingContext,
      pageNumber: data.pageNumber,
      createdAt: Date.now(),
    };
    setComments(prev => [...prev, comment]);
  }, [artifact]);

  const addImageComment = useCallback((data: { commentText: string }) => {
    const comment: ArtifactComment = {
      commentId: crypto.randomUUID(),
      artifactId: artifact.artifactId,
      artifactType: artifact.artifactType,
      artifactTitle: artifact.title,
      commentText: data.commentText,
      imageUrl: artifact.downloadUrl,
      createdAt: Date.now(),
    };
    setComments(prev => [...prev, comment]);
  }, [artifact]);

  const removeComment = useCallback((commentId: string) => {
    setComments(prev => prev.filter(c => c.commentId !== commentId));
  }, []);

  const clearComments = useCallback(() => setComments([]), []);

  return {
    comments,
    addTextComment,
    addImageComment,
    removeComment,
    clearComments,
    commentCount: comments.length,
  };
}
