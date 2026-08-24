import { describe, it, expect } from "vitest";
import * as dotenv from "dotenv";
import { GET as getHealthReady } from "@/app/api/health/ready/route";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

describe("Live Health Readiness Route Integration Tests", () => {
  it("returns HTTP 200 ready when live database and Redis are operational", async () => {
    const request = new Request("http://localhost:3000/api/health/ready", {
      headers: { "X-Request-ID": "test-readiness-probe" },
    });

    const response = await getHealthReady(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toBe("test-readiness-probe");

    const body = await response.json();
    expect(body.status).toBe("ready");
    expect(body.service).toBe("image-api");
    expect(body.checks.database).toBe("healthy");
    expect(body.checks.redis).toBe("healthy");
  });
});
