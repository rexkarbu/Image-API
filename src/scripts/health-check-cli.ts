import { validateTargetUrl, safeFetch } from "./deploy-verify";

export async function runHealthCheckCli(targetUrlString: string): Promise<void> {
  const targetUrl = validateTargetUrl(targetUrlString);
  const baseUrl = targetUrl.origin;

  console.log(`=== Querying Health Endpoints at ${baseUrl} ===\n`);

  // Liveness Check (Zero secret transmission)
  const liveRes = await safeFetch(`${baseUrl}/api/health/live`);
  const liveData = liveRes.json();
  console.log(`Liveness: [HTTP ${liveRes.status}]`);
  console.log(JSON.stringify(liveData, null, 2));

  console.log("\n--------------------------------------------------\n");

  // Readiness Check (Send health secret to /api/health/ready if configured)
  const readyHeaders: Record<string, string> = {};
  const healthSecret = process.env.HEALTHCHECK_SECRET;
  if (healthSecret && /^[0-9a-f]{64}$/.test(healthSecret)) {
    readyHeaders["Authorization"] = `Bearer ${healthSecret}`;
  }

  const readyRes = await safeFetch(`${baseUrl}/api/health/ready`, { headers: readyHeaders });
  const readyData = readyRes.json();
  console.log(`Readiness: [HTTP ${readyRes.status}]`);
  console.log(JSON.stringify(readyData, null, 2));

  if (liveRes.status !== 200 || readyRes.status !== 200) {
    throw new Error(`Health checks failed with liveness status ${liveRes.status} and readiness status ${readyRes.status}`);
  }
}

if (require.main === module || (typeof process.argv[1] === "string" && process.argv[1].endsWith("health-check-cli.ts"))) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const targetArg = args[0];
  if (!targetArg || targetArg.endsWith(".ts")) {
    console.error("Usage: pnpm health:check -- <base-url>");
    process.exitCode = 1;
  } else {
    runHealthCheckCli(targetArg).catch((err) => {
      console.error("Health check execution error:", (err as Error).message);
      process.exitCode = 1;
    });
  }
}
