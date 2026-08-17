export interface EditablePersonalPreferenceProfile {
  preferredLanguage: string | null;
  translationLanguage: string | null;
  translationMode: 'never' | 'when_requested' | 'always';
  tone: 'default' | 'friendly' | 'formal' | 'direct' | 'professional';
  verbosity: 'brief' | 'balanced' | 'detailed';
  complexity: 'simple' | 'standard' | 'technical' | 'executive';
  preferredFormat: 'auto' | 'bullets' | 'steps' | 'prose' | 'table';
  preferredDiagramFormat: 'auto' | 'mermaid' | 'ascii' | 'infographic';
  preferredDocumentFormat: 'auto' | 'markdown' | 'docx' | 'pdf';
  includeExamples: boolean | null;
  includeCitations: boolean | null;
}

/** Project a loaded profile onto the strict preference PATCH contract. */
export function toPersonalPreferencePatch(
  profile: EditablePersonalPreferenceProfile,
): EditablePersonalPreferenceProfile {
  return {
    preferredLanguage: profile.preferredLanguage,
    translationLanguage: profile.translationLanguage,
    translationMode: profile.translationMode,
    tone: profile.tone,
    verbosity: profile.verbosity,
    complexity: profile.complexity,
    preferredFormat: profile.preferredFormat,
    preferredDiagramFormat: profile.preferredDiagramFormat,
    preferredDocumentFormat: profile.preferredDocumentFormat,
    includeExamples: profile.includeExamples,
    includeCitations: profile.includeCitations,
  };
}
