import { registerOTel } from "@vercel/otel";

let otelRegistered = false;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && !otelRegistered) {
    otelRegistered = true;
    registerOTel({
      serviceName: "image-api",
    });
  }
}
