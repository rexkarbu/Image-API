import { NextResponse } from "next/server";
import { openApiSpec } from "@/lib/openapi/spec";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json(openApiSpec, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
