import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { checkDatabaseReadiness } from "@/lib/db/migrate";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    getConfig();
    await checkDatabaseReadiness();
    return NextResponse.json(
      { service: "test-portal", status: "ready" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[readiness] portal is not ready", {
      message: error instanceof Error ? error.message : "Unknown readiness error",
    });
    return NextResponse.json(
      { service: "test-portal", status: "not_ready" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
