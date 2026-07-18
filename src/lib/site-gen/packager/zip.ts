/**
 * Zip Packager
 *
 * Creates downloadable zip archives of generated websites.
 * Uses the `archiver` package (already a project dependency).
 *
 * Phase 9: Full implementation.
 */

import archiver from 'archiver';

/**
 * Package a directory into a zip buffer.
 * Stub — full implementation in Phase 9.
 */
export async function packageWebsite(
  outputDir: string,
  projectName: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    archive.directory(outputDir, projectName);
    archive.finalize();
  });
}

/**
 * Generate the zip filename from project name.
 */
export function getZipFilename(projectName: string): string {
  const sanitized = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${sanitized || 'website'}.zip`;
}
