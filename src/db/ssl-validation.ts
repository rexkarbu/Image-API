/**
 * Fail-closed PostgreSQL connection URL security validation.
 *
 * Enforces strict TLS verify-full on remote/Neon database URLs to ensure forward-compatibility
 * with modern libpq and pg driver semantics while preventing downgrade attacks.
 *
 * Invariants:
 * 1. Rejects missing, malformed, or non-postgres URLs.
 * 2. Permits local/loopback hosts (localhost, 127.0.0.1, ::1) without requiring TLS.
 * 3. On remote/Neon hosts:
 *    - Must contain exactly one `sslmode=verify-full`.
 *    - Rejects `prefer`, `require`, `verify-ca`, `allow`, `disable`, missing sslmode, and duplicate sslmode.
 *    - Rejects `uselibpqcompat` compatibility parameter.
 *    - Rejects conflicting or ambiguous `ssl` parameter.
 * 4. Error messages NEVER include credentials, passwords, usernames, or raw connection strings.
 */
export function validatePostgresUrlSecurity(
  urlString?: string | null,
  label: string = "PostgreSQL URL"
): { isValid: true; isLocal: boolean; sslmode: string | null } {
  if (!urlString || typeof urlString !== "string" || urlString.trim() === "") {
    throw new Error(`Security Check Failed: ${label} is missing.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Security Check Failed: ${label} is not a valid URL.`);
  }

  const validProtocols = ["postgres:", "postgresql:"];
  if (!validProtocols.includes(parsed.protocol)) {
    throw new Error(
      `Security Check Failed: ${label} protocol must be postgres: or postgresql:, got '${parsed.protocol}'.`
    );
  }

  const hostname = parsed.hostname;
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "";

  if (parsed.searchParams.has("uselibpqcompat")) {
    throw new Error(
      `Security Check Failed: ${label} must not use 'uselibpqcompat' compatibility parameter.`
    );
  }

  const sslModes = parsed.searchParams.getAll("sslmode");
  const sslParams = parsed.searchParams.getAll("ssl");

  // Localhost development placeholder without TLS
  if (isLocal) {
    if (sslModes.length > 1) {
      throw new Error(`Security Check Failed: ${label} contains duplicate 'sslmode' parameters.`);
    }
    if (sslModes.length === 1) {
      const mode = sslModes[0];
      if (mode !== "verify-full" && mode !== "disable") {
        throw new Error(
          `Security Check Failed: ${label} has invalid sslmode '${mode}'. Must be 'verify-full' or omitted for local connections.`
        );
      }
    }
    return { isValid: true, isLocal: true, sslmode: sslModes[0] ?? null };
  }

  // Remote / Neon database connections require strict verify-full TLS
  if (sslModes.length === 0) {
    throw new Error(
      `Security Check Failed: ${label} requires explicit 'sslmode=verify-full' for secure remote PostgreSQL connections.`
    );
  }

  if (sslModes.length > 1) {
    throw new Error(
      `Security Check Failed: ${label} contains duplicate 'sslmode' parameters.`
    );
  }

  const sslMode = sslModes[0];
  const rejectedModes = ["prefer", "require", "verify-ca", "allow", "disable", "no-verify"];

  if (sslMode !== "verify-full") {
    if (rejectedModes.includes(sslMode.toLowerCase())) {
      throw new Error(
        `Security Check Failed: ${label} uses deprecated or weak sslmode '${sslMode}'. Must be strictly 'sslmode=verify-full'.`
      );
    }
    throw new Error(
      `Security Check Failed: ${label} has unrecognized sslmode '${sslMode}'. Must be strictly 'sslmode=verify-full'.`
    );
  }

  if (sslParams.length > 0) {
    for (const p of sslParams) {
      if (
        p === "false" ||
        p === "0" ||
        p === "disable" ||
        p === "allow" ||
        p === "prefer" ||
        p === "require"
      ) {
        throw new Error(
          `Security Check Failed: ${label} contains ambiguous or conflicting 'ssl' parameter '${p}'.`
        );
      }
    }
  }

  return { isValid: true, isLocal: false, sslmode: "verify-full" };
}
