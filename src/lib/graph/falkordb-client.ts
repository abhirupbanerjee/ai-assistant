/**
 * FalkorDB Client Singleton
 *
 * Provides a lazy-initialized FalkorDB graph handle with health check
 * and schema initialization for graph-augmented RAG (Phase 2).
 *
 * FalkorDB uses port 6380 to avoid conflict with Redis on 6379.
 * Connection params come from FALKORDB_HOST / FALKORDB_PORT / FALKORDB_GRAPH_NAME env vars.
 */

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 6380;
const DEFAULT_GRAPH_NAME = 'policybot';

let graphInstance: any = null;
let dbInstance: any = null;
let FalkorDBSdk: any = null;

/**
 * Lazily load the FalkorDB SDK. Uses dynamic import so the app boots
 * even when falkordb is not installed (graph features gracefully degrade).
 */
async function getFalkorDBSdk(): Promise<any> {
  if (FalkorDBSdk) return FalkorDBSdk;
  try {
    const mod = await import('falkordb');
    FalkorDBSdk = mod.FalkorDB || mod.default?.FalkorDB || mod.default;
    return FalkorDBSdk;
  } catch {
    throw new Error(
      'FalkorDB SDK not installed. Run: npm install falkordb'
    );
  }
}

function getConfig() {
  return {
    host: process.env.FALKORDB_HOST || DEFAULT_HOST,
    port: parseInt(process.env.FALKORDB_PORT || String(DEFAULT_PORT), 10),
    graphName: process.env.FALKORDB_GRAPH_NAME || DEFAULT_GRAPH_NAME,
  };
}

/**
 * Get or create the FalkorDB connection and graph handle.
 * Lazy singleton — connects on first use, reuses thereafter.
 */
export async function getGraph(): Promise<any> {
  if (graphInstance) return graphInstance;

  const { host, port, graphName } = getConfig();
  const FalkorDB = await getFalkorDBSdk();

  dbInstance = await FalkorDB.connect({
    socket: { host, port },
  });

  graphInstance = dbInstance.selectGraph(graphName);
  return graphInstance;
}

/**
 * Health check — returns true if FalkorDB is reachable and responsive.
 */
export async function isGraphHealthy(): Promise<boolean> {
  try {
    const graph = await getGraph();
    // Run a lightweight Cypher query to verify connectivity
    await graph.query('RETURN 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize the graph schema (indices, constraints).
 * Idempotent — safe to call on every startup. Errors on duplicate
 * indices are caught and ignored (FalkorDB doesn't support IF NOT EXISTS).
 */
export async function initGraphSchema(): Promise<void> {
  const graph = await getGraph();

  const statements = [
    'CREATE INDEX FOR (e:Entity) ON (e.id)',
    'CREATE INDEX FOR (c:Chunk) ON (c.qdrantId)',
    'CREATE INDEX FOR (d:Document) ON (d.id)',
  ];

  for (const stmt of statements) {
    try {
      await graph.query(stmt);
    } catch (err: any) {
      // Index already exists — safe to ignore (FalkorDB error messages vary)
      const msg = err?.message || '';
      if (!msg.includes('already exists') && !msg.includes('already indexed')) {
        throw err;
      }
    }
  }
}

/**
 * Delete all Chunk nodes for a document and orphaned Entity nodes.
 * Called when a document is removed from Qdrant.
 */
export async function cleanupGraphForDocument(documentId: string): Promise<void> {
  const graph = await getGraph();

  // Delete Chunk nodes (DETACH DELETE removes their relationships too)
  await graph.query(
    'MATCH (c:Chunk {documentId: $id}) DETACH DELETE c',
    { params: { id: documentId } }
  );

  // Delete orphaned Entity nodes (no remaining MENTIONS edges)
  await graph.query(
    'MATCH (e:Entity) WHERE NOT (e)-[:MENTIONS]->(:Chunk) DELETE e'
  );
}

/**
 * Retry wrapper for FalkorDB graph.query() with exponential backoff.
 *
 * Handles transient socket drops and connection resets during heavy parallel writes.
 * Retries up to 3 times with 100ms, 200ms, 400ms delays.
 */
export async function retryGraphQuery(
  graph: any,
  query: string,
  params?: Record<string, any>,
  maxRetries: number = 3,
): Promise<any> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await graph.query(query, { params: params || {} });
    } catch (err: any) {
      lastError = err;
      const isTransient = /ECONNRESET|ETIMEDOUT|socket hang up|Connection refused/i.test(String(err));
      if (!isTransient || attempt === maxRetries) break;
      const delay = 100 * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Reset the client (e.g., after config change). Next getGraph() reconnects.
 */
export function resetGraphClient(): void {
  graphInstance = null;
  dbInstance = null;
}
