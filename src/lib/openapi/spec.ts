export const openApiSpec = {
  openapi: "3.1.1",
  info: {
    title: "Image API Developer Platform",
    version: "1.0.0",
    description:
      "Enterprise-grade, distributed multi-tenant image transformation and metered billing platform. Provides sub-50ms Sharp processing, strict tenancy isolation, and high-concurrency rate limiting.",
    contact: {
      name: "Image API Developer Support",
      url: "https://github.com/rexkarbu/Image-API",
    },
    license: {
      name: "MIT",
      url: "https://opensource.org/licenses/MIT",
    },
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Local Development Server",
    },
    {
      url: "https://api.imageapi.dev",
      description: "Production Gateway (Target)",
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
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        required: ["error", "message"],
        properties: {
          error: {
            type: "string",
            example: "UNAUTHORIZED",
            description: "Machine-readable error code.",
          },
          message: {
            type: "string",
            example: "Missing or invalid API key.",
            description: "Human-readable sanitized error description.",
          },
          details: {
            type: "object",
            description: "Optional context-specific error details.",
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
          "Accepts a multipart image payload, applies requested transformations (resize, re-encode, format conversion, quality tuning), returns binary image output, and records exactly 1 metered usage event.",
        operationId: "transformImage",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: {
              type: "string",
              minLength: 1,
              maxLength: 128,
            },
            description:
              "Unique client-generated token guaranteeing exactly-once transformation execution and billing.",
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
                      "Source image binary (max 10MB). Supported formats: JPEG, PNG, WebP, AVIF.",
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
                    description: "Target output format (defaults to source format if omitted).",
                    example: "webp",
                  },
                  quality: {
                    type: "integer",
                    minimum: 1,
                    maximum: 100,
                    default: 80,
                    description: "Compression quality parameter (1..100).",
                    example: 80,
                  },
                  fit: {
                    type: "string",
                    enum: ["cover", "contain", "fill", "inside", "outside"],
                    default: "cover",
                    description: "Resize fit strategy.",
                    example: "cover",
                  },
                  withoutEnlargement: {
                    type: "boolean",
                    default: false,
                    description: "Prevent upscale if source is smaller than target dimensions.",
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
              "X-Usage-Units": {
                schema: { type: "integer", example: 1 },
                description: "Metered billable units recorded for this transformation (1).",
              },
              "X-RateLimit-Limit-IP": {
                schema: { type: "integer" },
                description: "IP rate limit capacity (tokens/window).",
              },
              "X-RateLimit-Remaining-IP": {
                schema: { type: "integer" },
                description: "Remaining IP rate limit allowance.",
              },
              "X-RateLimit-Reset-IP": {
                schema: { type: "integer" },
                description: "Unix epoch timestamp when IP rate limit window resets.",
              },
              "X-RateLimit-Limit-Key": {
                schema: { type: "integer" },
                description: "API Key rate limit capacity.",
              },
              "X-RateLimit-Remaining-Key": {
                schema: { type: "integer" },
                description: "Remaining API Key rate limit allowance.",
              },
              "X-RateLimit-Reset-Key": {
                schema: { type: "integer" },
                description: "Unix epoch timestamp when API Key rate limit resets.",
              },
              "X-Request-ID": {
                schema: { type: "string" },
                description: "Unique request correlation identifier.",
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
            description: "Bad Request — Invalid transformation parameters or malformed multipart.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
          },
          "401": {
            description: "Unauthorized — Missing, invalid, revoked, or expired API Key.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
          },
          "409": {
            description: "Conflict — Duplicate request with identical Idempotency-Key.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
          },
          "413": {
            description: "Payload Too Large — Image file exceeds 10MB limit.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
          },
          "415": {
            description: "Unsupported Media Type — Image format is not supported.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
          },
          "422": {
            description: "Unprocessable Entity — Corrupt or unreadable image bytes.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
          },
          "429": {
            description: "Too Many Requests — IP or API-Key rate limit capacity exhausted.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
          },
          "500": {
            description: "Internal Server Error — Unexpected processing error.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
          },
          "503": {
            description: "Service Unavailable — Distributed rate limiter or database temporarily unavailable.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
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
          "Validates critical transformation request dependencies (PostgreSQL database read-check and Upstash Redis rate limiter ping) in parallel with a 2500ms timeout.",
        operationId: "getReadiness",
        security: [],
        responses: {
          "200": {
            description: "All critical request-path dependencies are ready.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthReadyResponse" },
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
