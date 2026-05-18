/**
 * Remove trailing slashes before appending absolute paths.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}
