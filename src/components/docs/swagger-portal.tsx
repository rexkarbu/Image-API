"use client";

import React, { useEffect, useRef, useState } from "react";
import "swagger-ui-dist/swagger-ui.css";
import { openApiSpec } from "@/lib/openapi/spec";

export function SwaggerPortal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    import("swagger-ui-dist/swagger-ui-bundle").then((module) => {
      if (isCancelled || !containerRef.current) return;
      setMounted(true);
      const SwaggerUIBundle = module.default || module;
      SwaggerUIBundle({
        domNode: containerRef.current,
        spec: openApiSpec,
        deepLinking: true,
        persistAuthorization: false,
        displayRequestDuration: true,
        docExpansion: "list",
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        defaultModelsExpandDepth: 2,
        defaultModelExpandDepth: 2,
      });
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
      {/* Session-only Credential Warning Notice */}
      <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-3 text-center text-sm font-medium text-amber-200">
        <span className="mr-2">⚠️</span>
        <strong>Test Credentials Notice:</strong> API Keys entered into this interactive console remain strictly in-memory within your current browser session and are never persisted to local storage, session storage, or cookies.
      </div>

      {/* Header Bar */}
      <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur-md sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-base text-neutral-100">Image API</span>
          <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">OpenAPI 3.1.1</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <a
            href="/openapi.json"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-400 hover:text-neutral-100 transition-colors"
          >
            Raw OpenAPI JSON
          </a>
          <a
            href="/dashboard"
            className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium border border-neutral-700 transition-colors"
          >
            Developer Dashboard →
          </a>
        </div>
      </header>

      {/* Main Swagger UI Container */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 sm:p-6 shadow-2xl backdrop-blur-sm">
          {!mounted && (
            <div className="py-16 flex items-center justify-center text-neutral-400 text-sm">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-emerald-500" />
                <span>Loading Interactive Documentation...</span>
              </div>
            </div>
          )}
          <div id="swagger-ui-container" ref={containerRef} className="swagger-dark-theme" />
        </div>
      </main>

      <style jsx global>{`
        .swagger-dark-theme .swagger-ui {
          color: #e5e5e5;
        }
        .swagger-dark-theme .swagger-ui .info .title {
          color: #f5f5f5;
        }
        .swagger-dark-theme .swagger-ui .info p,
        .swagger-dark-theme .swagger-ui .info li {
          color: #a3a3a3;
        }
        .swagger-dark-theme .swagger-ui .scheme-container {
          background: #171717;
          box-shadow: none;
          border-radius: 8px;
          border: 1px solid #262626;
          padding: 16px;
        }
        .swagger-dark-theme .swagger-ui .opblock {
          background: #171717 !important;
          border: 1px solid #262626 !important;
          border-radius: 8px !important;
          box-shadow: none !important;
          margin-bottom: 16px !important;
        }
        .swagger-dark-theme .swagger-ui .opblock .opblock-summary {
          border-color: #262626 !important;
        }
        .swagger-dark-theme .swagger-ui .opblock .opblock-summary-method {
          border-radius: 6px !important;
          font-weight: 600 !important;
        }
        .swagger-dark-theme .swagger-ui .opblock-description-wrapper p {
          color: #a3a3a3 !important;
        }
        .swagger-dark-theme .swagger-ui table thead tr td,
        .swagger-dark-theme .swagger-ui table thead tr th {
          color: #d4d4d4 !important;
          border-color: #262626 !important;
        }
        .swagger-dark-theme .swagger-ui .tabli button {
          color: #a3a3a3 !important;
        }
        .swagger-dark-theme .swagger-ui .tabli.active button {
          color: #ffffff !important;
        }
        .swagger-dark-theme .swagger-ui .response-col_status {
          color: #e5e5e5 !important;
        }
        .swagger-dark-theme .swagger-ui .response-col_description {
          color: #a3a3a3 !important;
        }
        .swagger-dark-theme .swagger-ui input[type="text"],
        .swagger-dark-theme .swagger-ui input[type="password"],
        .swagger-dark-theme .swagger-ui textarea,
        .swagger-dark-theme .swagger-ui select {
          background: #0a0a0a !important;
          color: #ffffff !important;
          border: 1px solid #333333 !important;
          border-radius: 6px !important;
        }
        .swagger-dark-theme .swagger-ui .btn {
          border-radius: 6px !important;
        }
      `}</style>
    </div>
  );
}
