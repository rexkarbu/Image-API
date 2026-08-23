/**
 * Pre-load hook for standalone Node.js / CLI execution.
 * Intercepts React Server Components' `server-only` package so server services
 * can be executed by CLI scripts outside Next.js bundling while preserving
 * client-bundle isolation during `next build`.
 */
try {
  const resolved = require.resolve("server-only");
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: {},
    require: require,
    children: [],
    paths: [],
    path: "",
  } as any;
} catch {
  // Ignore
}
