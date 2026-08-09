export type CanvasMode = 'normal' | 'canvas';

export interface ArtifactCanvasItem {
  artifactId: string;
  artifactType: 'html' | 'docx' | 'md' | 'pdf' | 'pptx' | 'xlsx' | 'image' | 'diagram' | 'chart' | 'podcast' | 'zip';
  title: string;
  downloadUrl: string;
  // For Drive-embedded artifacts:
  embedUrl?: string;
  driveFileId?: string;
  // For Mermaid diagrams (source of truth = DiagramHint source):
  mermaidCode?: string;
  // For charts (synthetic artifactId from MessageVisualization):
  chartData?: Record<string, unknown>[];
  chartType?: string;
  // For ZIP files shown as a simple file list / download-only viewer:
  zipEntries?: { name: string; size?: number }[];
}

/** A single comment attached to an artifact (Phase 2a Path A). */
export interface ArtifactComment {
  commentId: string;
  artifactId: string;
  artifactType: string;
  artifactTitle: string;
  commentText: string;

  // Path A text selection fields:
  selectedText?: string;
  surroundingContext?: string;
  pageNumber?: number;

  // Image-only field:
  imageUrl?: string;

  createdAt: number;
}

export interface ArtifactCommentContext {
  comments: ArtifactComment[];
}

export interface ArtifactContext {
  artifactId: string;
  artifactType: string;
  artifactTitle: string;
  // Path A:
  textContent?: string;
  selectedText?: string;
  // Path B:
  screenshotBase64?: string;
  // Always:
  userQuestion: string;
}
