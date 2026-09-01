import { initTelemetry, shutdownTelemetry } from "./lib/telemetry";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { closeRedis } from "./lib/redis";

const SERVICE_NAME = "api-gateway";
const SERVICE_VERSION = "1.1.0";

async function bootstrap(): Promise<void> {
  initTelemetry(SERVICE_NAME, SERVICE_VERSION);

  const { createApp } = await import("./app");
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`${SERVICE_NAME} listening on port ${env.PORT}`, { env: env.NODE_ENV });
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await shutdownTelemetry();
      await closeRedis().catch(() => undefined);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void bootstrap();