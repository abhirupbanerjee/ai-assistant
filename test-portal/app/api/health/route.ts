import { NextResponse } from "next/server";

export function GET(): NextResponse {
  return NextResponse.json(
    {
      service: "test-portal",
      status: "ok",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
