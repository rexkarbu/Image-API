import { describe, it, expect } from "vitest";
import { GET as getHealthLive } from "@/app/api/health/live/route";

describe("Health Check Routes Unit Tests", () => {
  describe("GET /api/health/live", () => {
    it("returns HTTP 200 with minimal status and security headers", async () => {
      const request = new Request("http://localhost:3000/api/health/live", {
        headers: {
          "X-Request-ID": "custom-probe-id-12345",
        },
      });

      const response = await getHealthLive(request);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-request-id")).toBe("custom-probe-id-12345");

      const body = await response.json();
      expect(body).toEqual({
        status: "ok",
        service: "image-api",
      });
    });

    it("generates a valid X-Request-ID when omitted from request", async () => {
      const request = new Request("http://localhost:3000/api/health/live");
      const response = await getHealthLive(request);

      expect(response.status).toBe(200);
      const reqId = response.headers.get("x-request-id");
      expect(reqId).toBeDefined();
      expect(reqId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });
});
