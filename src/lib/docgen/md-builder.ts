/**
 * Markdown Builder - Generate Markdown documents
 *
 * Handles Markdown document generation with:
 * - Title as heading
 * - Content pass-through (already markdown)
 * - Metadata at the end (organization, title, author)
 *
 * Note: MD format does not support headers/footers or logos.
 * Branding info is placed as metadata at the end of the document.
 */

import { type BrandingConfig } from './branding';
import { type DisclaimerConfig } from '../disclaimer';

// ============ Types ============

export interface MdOptions {
  title: string;
  content: string;
  branding: BrandingConfig;
  disclaimerConfig?: DisclaimerConfig | null;
  metadata?: {
    author?: string;
    date?: string;
  };
}

export interface MdResult {
  buffer: Buffer;
  fileSize: number;
}

// ============ MD Builder ============

/**
 * Generate a Markdown document with metadata at the end
 */
export async function generateMd(options: MdOptions): Promise<MdResult> {
  const { title, content, branding, disclaimerConfig, metadata } = options;
  const lines: string[] = [];

  // Add title as H1
  lines.push(`# ${title}`);
  lines.push('');

  // Add content (already markdown, pass through as-is)
  lines.push(content);

  // Add metadata section at the end if branding is enabled
  if (branding.enabled) {
    const metadataLines: string[] = [];

    // Organization name
    if (branding.organizationName) {
      metadataLines.push(`**Organization:** ${branding.organizationName}`);
    }

    // Document title
    metadataLines.push(`**Document:** ${title}`);

    // Author/Publisher
    if (metadata?.author) {
      metadataLines.push(`**Author:** ${metadata.author}`);
    }

    // Date
    if (metadata?.date) {
      metadataLines.push(`**Date:** ${metadata.date}`);
    }

    // Add metadata section if we have any
    if (metadataLines.length > 0) {
      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push('*Document Information:*');
      lines.push('');
      for (const line of metadataLines) {
        lines.push(line);
      }
    }
  }

  // Add AI disclaimer if enabled
  if (disclaimerConfig?.enabled) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`*${disclaimerConfig.fullText}*`);
  }

  // Ensure file ends with newline
  const text = lines.join('\n') + '\n';
  const buffer = Buffer.from(text, 'utf-8');

  return {
    buffer,
    fileSize: buffer.length,
  };
}

// ============ Convenience Class ============

export class MdBuilder {
  private options: MdOptions;

  constructor(options: MdOptions) {
    this.options = options;
  }

  async generate(): Promise<MdResult> {
    return generateMd(this.options);
  }
}
