import { types, type Pool as PoolType } from "pg";

import { getConfig } from "../config";

// Portal DB timestamps are strings at the driver boundary, never Date objects.
types.setTypeParser(1114, (value: string) => value);
types.setTypeParser(1184, (value: string) => value);

let pool: PoolType | undefined;
let poolPromise: Promise<PoolType> | undefined;
let shutdownHandlersRegistered = false;

export async function getPool(): Promise<PoolType> {
  if (pool) return pool;
  poolPromise ??= createPool();
  try {
    pool = await poolPromise;
    return pool;
  } catch (error) {
    poolPromise = undefined;
    throw error;
  }
}

async function createPool(): Promise<PoolType> {
    const { Pool } = await import("pg");
    const config = getConfig();
    const createdPool = new Pool({
      connectionString: config.databaseUrl,
      application_name: "test-portal",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 10,
      ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
    });
    createdPool.on("error", (error) => {
      console.error("[portal-db] idle connection error", { message: error.message });
    });
    registerShutdownHandlers();
    return createdPool;
}

function registerShutdownHandlers(): void {
  if (shutdownHandlersRegistered) return;
  shutdownHandlersRegistered = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void closePool().finally(() => process.exit(0));
    });
  }
}

export async function closePool(): Promise<void> {
  const activePool = pool ?? await poolPromise?.catch(() => undefined);
  pool = undefined;
  poolPromise = undefined;
  if (activePool) await activePool.end();
}
