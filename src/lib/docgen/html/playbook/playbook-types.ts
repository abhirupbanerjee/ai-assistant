/**
 * Playbook-specific types and helpers.
 */

export interface PlaybookTopic {
  id: string;
  title: string;
  subtitle: string;
  bodyHtml: string;
  keywords: string;
}

export interface PlaybookPart {
  partLabel: string;
  title: string;
  id: string;
  accentColor: string;
  introHtml: string; // Content before any topics
  topics: PlaybookTopic[];
}
