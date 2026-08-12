import { PHASE_PRODUCTION_BUILD } from "next/constants";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;

  const [{ getConfig }, { runMigrations }] = await Promise.all([
    import("./lib/config"),
    import("./lib/db/migrate"),
  ]);
  getConfig();
  await runMigrations();
}
