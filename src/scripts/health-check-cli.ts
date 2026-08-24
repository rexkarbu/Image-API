import { validateTargetUrl } from "./deploy-verify";

export async function runHealthCheckCli(targetUrlString: string): Promise<void> {
  const targetUrl = validateTargetUrl(targetUrlString);
  const baseUrl = targetUrl.origin;

  console.log(`=== Querying Health Endpoints at ${baseUrl} ===\n`);

  try {
    const liveRes = await fetch(`${baseUrl}/api/health/live`);
    const liveData = await liveRes.json();
    console.log(`Liveness: [HTTP ${liveRes.status}]`);
    console.log(JSON.stringify(liveData, null, 2));

    console.log("\n--------------------------------------------------\n");

    const readyRes = await fetch(`${baseUrl}/api/health/ready`);
    const readyData = await readyRes.json();
    console.log(`Readiness: [HTTP ${readyRes.status}]`);
    console.log(JSON.stringify(readyData, null, 2));

    if (liveRes.status !== 200 || readyRes.status !== 200) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Health check execution error:", (err as Error).message);
    process.exit(1);
  }
}

if (require.main === module || (typeof process.argv[1] === "string" && process.argv[1].endsWith("health-check-cli.ts"))) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const targetArg = args[0];
  if (!targetArg || targetArg.endsWith(".ts")) {
    console.error("Usage: pnpm health:check -- <base-url>");
    process.exit(1);
  }

  runHealthCheckCli(targetArg);
}
