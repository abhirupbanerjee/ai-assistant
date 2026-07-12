/**
 * Embed Script Generator
 *
 * Generates HTML snippets for embedding the workspace chat widget on external websites.
 */

import type { Workspace } from '@/types/workspace';

export interface EmbedScriptOptions {
  /** Position of the widget */
  position?: 'bottom-right' | 'bottom-left';
  /** Horizontal offset in pixels */
  offsetX?: number;
  /** Vertical offset in pixels */
  offsetY?: number;
}

/**
 * Generate the embed script HTML snippet for a workspace
 */
export function generateEmbedScript(
  workspace: Workspace,
  baseUrl: string,
  options: EmbedScriptOptions = {}
): string {
  const { position = 'bottom-right', offsetX = 20, offsetY = 20 } = options;

  // Build data attributes
  const dataAttrs = [
    `data-workspace-id="${workspace.slug}"`,
    `data-api-base="${baseUrl}"`,
  ];

  if (position !== 'bottom-right') {
    dataAttrs.push(`data-position="${position}"`);
  }
  if (offsetX !== 20) {
    dataAttrs.push(`data-offset-x="${offsetX}"`);
  }
  if (offsetY !== 20) {
    dataAttrs.push(`data-offset-y="${offsetY}"`);
  }

  const scriptUrl = `${baseUrl}/embed/workspace.js`;

  return `<!-- AI Assistant Embed -->
<script
  src="${scriptUrl}"
  ${dataAttrs.join('\n  ')}
  async
></script>`;
}

/**
 * Generate the embed script with customization options
 */
export function generateEmbedScriptWithOptions(
  workspace: Workspace,
  baseUrl: string
): {
  basic: string;
  withOptions: string;
  manual: string;
} {
  const scriptUrl = `${baseUrl}/embed/workspace.js`;

  const basic = generateEmbedScript(workspace, baseUrl);

  const withOptions = `<!-- AI Assistant Embed (with customization) -->
<script
  src="${scriptUrl}"
  data-workspace-id="${workspace.slug}"
  data-api-base="${baseUrl}"
  data-position="bottom-right"
  data-offset-x="20"
  data-offset-y="20"
  async
></script>`;

  const manual = `<!-- AI Assistant Embed (manual initialization) -->
<script src="${scriptUrl}" async></script>
<script>
  window.addEventListener('load', function() {
    AIAssistantEmbed({
      workspaceId: '${workspace.slug}',
      apiBaseUrl: '${baseUrl}',
      position: 'bottom-right',
      offsetX: 20,
      offsetY: 20
    });
  });
</script>`;

  return { basic, withOptions, manual };
}

/**
 * Generate an iframe embed code for the hosted embed page
 */
export function generateIframeEmbed(
  workspace: Workspace,
  baseUrl: string,
  options: { width?: string; height?: string } = {}
): string {
  const { width = '400px', height = '600px' } = options;
  const embedUrl = `${baseUrl}/e/${workspace.slug}`;

  return `<!-- AI Assistant Embed (iframe) -->
<iframe
  src="${embedUrl}"
  width="${width}"
  height="${height}"
  frameborder="0"
  style="border: none; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);"
  allow="microphone"
></iframe>`;
}

/**
 * Get the direct link to the hosted embed page
 */
export function getHostedEmbedUrl(workspace: Workspace, baseUrl: string): string {
  return `${baseUrl}/e/${workspace.slug}`;
}

/**
 * Get the standalone workspace URL
 */
export function getStandaloneUrl(workspace: Workspace, baseUrl: string): string {
  return `${baseUrl}/${workspace.slug}`;
}
