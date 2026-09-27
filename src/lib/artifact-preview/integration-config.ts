/** Intentionally never falls back to DATABASE_URL. Only a separately provisioned
 * disposable local database can be selected for the opt-in integration suite. */
export function integrationDatabaseUrl(env: Record<string, string | undefined> = process.env) {
  if (env.ARTIFACT_PREVIEW_DB_TEST !== 'true') return null;
  const raw = env.ARTIFACT_PREVIEW_TEST_DATABASE_URL;
  if (!raw) throw new Error('A dedicated artifact preview test database URL is required');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid artifact preview test database URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) ||
    !/^\/artifact_preview_test(?:_[a-z0-9_]+)?$/.test(url.pathname) || url.search || url.hash || raw === env.DATABASE_URL) {
    throw new Error('Artifact preview tests require a dedicated local artifact_preview_test database');
  }
  if (env.DATABASE_URL) {
    let application: URL;
    try { application = new URL(env.DATABASE_URL); } catch { throw new Error('Cannot verify isolation from the application database'); }
    const local = ['localhost','127.0.0.1','[::1]'].includes(application.hostname);
    if (local && (application.port || '5432') === (url.port || '5432') && decodeURIComponent(application.pathname) === url.pathname) {
      throw new Error('Artifact preview tests cannot use the application database');
    }
  }
  return raw;
}
