export const openApiSpec = {
  openapi: "3.1.1",
  info: {
    title: "Image API Developer Platform",
    version: "1.0.0",
    description:
      "Usage-based developer platform for image resizing, format conversion, and optimization. Features fail-closed rate limiting, strict multi-tenant isolation, and atomic usage metering.",
    contact: {
      name: "Image API Developer Support",
      url: "https://github.com/rexkarbu/Image-API",
    },
  },
  servers: [
    {
      url: "/",
      description: "Current Server Origin",
    },
  ],
  security: [
    {
      BearerAuth: [],
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "img_live_...",
        description:
          "API Key issued from developer dashboard. Must begin with 'img_live_' and possess the 'image:transform' scope.",
      },
      HealthSecretAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "64-character hexadecimal healthcheck secret required in production environments.",
      },
    },
    schemas: {
      ErrorEnvelope: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "requestId"],
            properties: {
              code: {
                type: "string",
                example: "UNAUTHORIZED",
                description: "Machine-readable domain error code.",
              },
              message: {
                type: "string",
                example: "Invalid API credentials.",
                description: "Sanitized human-readable error description.",
              },
              requestId: {
                type: "string",
                example: "38378f24-e954-4808-a5e3-adc322016d77",
                description: "Request correlation identifier.",
              },
            },
          },
        },
      },
      HealthLiveResponse: {
        type: "object",
        required: ["status", "service"],
        properties: {
          status: {
            type: "string",
            example: "ok",
          },
          service: {
            type: "string",
            example: "image-api",
          },
        },
      },
      HealthReadyResponse: {
        type: "object",
        required: ["status", "service", "checks"],
        properties: {
          status: {
            type: "string",
            enum: ["ready", "unhealthy"],
            example: "ready",
          },
          service: {
            type: "string",
            example: "image-api",
          },
          checks: {
            type: "object",
            required: ["database", "redis"],
            properties: {
              database: {
                type: "string",
                enum: ["healthy", "unhealthy"],
                example: "healthy",
              },
              redis: {
                type: "string",
                enum: ["healthy", "unhealthy"],
                example: "healthy",
              },
            },
          },
        },
      },
    },
  },
  paths: {
    "/v1/images/transform": {
      post: {
        summary: "Transform and optimize an image",
        description:
          "Accepts a multipart image payload (JPEG, PNG, WebP), applies requested transformations (resize, re-encode, format conversion, quality tuning), returns binary image output, and records exactly 1 metered usage event upon completion. Duplicate requests with the same Idempotency-Key within an organization return 409 DUPLICATE_REQUEST without double metering.",
        operationId: "transformImage",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: {
              type: "string",
              minLength: 16,
              maxLength: 128,
              pattern: "^[!-~]{16,128}$",
            },
            description:
              "Unique client-generated token (16-128 printable ASCII characters without whitespace) guaranteeing deduplication and atomic metering.",
            example: "idem_9f82b7c4_20260824",
          },
          {
            name: "X-Request-ID",
            in: "header",
            required: false,
            schema: {
              type: "string",
              maxLength: 128,
            },
            description: "Optional client request correlation identifier.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: {
                    type: "string",
                    format: "binary",
                    description:
                      "Source image binary (max 10MB). Supported input formats: JPEG, PNG, WebP (AVIF input is rejected).",
                  },
                  width: {
                    type: "integer",
                    minimum: 1,
                    maximum: 4096,
                    description: "Target output width in pixels (1..4096).",
                    example: 800,
                  },
                  height: {
                    type: "integer",
                    minimum: 1,
                    maximum: 4096,
                    description: "Target output height in pixels (1..4096).",
                    example: 600,
                  },
                  format: {
                    type: "string",
                    enum: ["webp", "jpeg", "png", "avif"],
                    default: "webp",
                    description: "Target output format (defaults to 'webp').",
                    example: "webp",
                  },
                  quality: {
                    type: "integer",
                    minimum: 1,
                    maximum: 100,
                    default: 80,
                    description: "Compression quality parameter (1..100). Invalid when format is 'png'.",
                    example: 80,
                  },
                  fit: {
                    type: "string",
                    enum: ["cover", "contain", "inside", "fill"],
                    default: "inside",
                    description: "Resize fit strategy (defaults to 'inside'). Requires both width and height to be set.",
                    example: "inside",
                  },
                  withoutEnlargement: {
                    type: "boolean",
                    default: true,
                    description: "Prevent upscale if source image is smaller than target dimensions (defaults to true).",
                    example: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Image transformation succeeded. Returns optimized binary image data.",
            headers: {
              "Content-Type": {
                schema: { type: "string", example: "image/webp" },
                description: "MIME type of output image.",
              },
              "Content-Length": {
                schema: { type: "string", example: "45120" },
                description: "Output image size in bytes.",
              },
              "Content-Disposition": {
                schema: { type: "string", example: 'inline; filename="transformed.webp"' },
                description: "Content disposition header.",
              },
              "Cache-Control": {
                schema: { type: "string", example: "no-store" },
                description: "Cache control policy.",
              },
              "X-Content-Type-Options": {
                schema: { type: "string", example: "nosniff" },
                description: "Security header preventing MIME sniffing.",
              },
              "X-Request-ID": {
                schema: { type: "string" },
                description: "Unique request correlation identifier.",
              },
              "X-Usage-Units": {
                schema: { type: "string", example: "1" },
                description: "Metered billable units recorded for this transformation (1).",
              },
              "X-Image-Width": {
                schema: { type: "string", example: "800" },
                description: "Output image width in pixels.",
              },
              "X-Image-Height": {
                schema: { type: "string", example: "600" },
                description: "Output image height in pixels.",
              },
              "X-RateLimit-Limit": {
                schema: { type: "integer", example: 20 },
                description: "Authenticated API key rate limit capacity (tokens).",
              },
              "X-RateLimit-Remaining": {
                schema: { type: "integer", example: 19 },
                description: "Remaining API key token allowance.",
              },
              "X-RateLimit-Reset": {
                schema: { type: "integer", example: 1724500000 },
                description: "Unix epoch timestamp in seconds when the rate limit window resets.",
              },
            },
            content: {
              "image/webp": { schema: { type: "string", format: "binary" } },
              "image/jpeg": { schema: { type: "string", format: "binary" } },
              "image/png": { schema: { type: "string", format: "binary" } },
              "image/avif": { schema: { type: "string", format: "binary" } },
            },
          },
          "400": {
            description: "Bad Request — Invalid transformation parameters, invalid Idempotency-Key format, or malformed multipart.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
          },
          "401": {
            description: "Unauthorized — Missing, invalid, revoked, or expired API Key ('Invalid API credentials.').",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
          },
          "409": {
            description: "Conflict — Duplicate request with identical Idempotency-Key within tenant.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
          },
          "413": {
            description: "Payload Too Large — Image file exceeds 10MB limit.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
          },
          "415": {
            description: "Unsupported Media Type — Image format is not supported (only JPEG, PNG, WebP input).",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
          },
          "422": {
            description: "Unprocessable Entity — Corrupt or unreadable image bytes.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
          },
          "429": {
            description: "Too Many Requests — IP or API-Key rate limit capacity exhausted.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
          },
          "500": {
            description: "Internal Server Error — Unexpected processing error.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
          },
          "503": {
            description: "Service Unavailable — Distributed rate limiter or database temporarily unavailable.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } },
          },
        },
      },
    },
    "/api/health/live": {
      get: {
        summary: "Process Liveness Check",
        description:
          "Checks if the application process is alive and accepting requests. Performs zero network I/O.",
        operationId: "getLiveness",
        security: [],
        responses: {
          "200": {
            description: "Application process is healthy.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthLiveResponse" },
              },
            },
          },
        },
      },
    },
    "/api/health/ready": {
      get: {
        summary: "Request-Path Readiness Check",
        description:
          "Validates critical transformation request dependencies (PostgreSQL database read check and Upstash Redis rate limiter ping) in parallel with driver-level timeouts. In production and preview environments, strictly requires Bearer authentication with HEALTHCHECK_SECRET. Local development and loopback test environments permit unauthenticated diagnostic probes.",
        operationId: "getReadiness",
        security: [
          {
            HealthSecretAuth: [],
          },
        ],
        responses: {
          "200": {
            description: "All critical request-path dependencies are ready.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthReadyResponse" },
              },
            },
          },
          "401": {
            description: "Unauthorized — Missing or invalid HEALTHCHECK_SECRET in production.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorEnvelope" },
              },
            },
          },
          "503": {
            description: "One or more critical dependencies failed or timed out.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthReadyResponse" },
              },
            },
          },
        },
      },
    },
  },
};
