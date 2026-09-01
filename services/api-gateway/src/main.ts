import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { closeRedis } from "./lib/redis";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`api-gateway listening on port ${env.PORT}`, { env: env.NODE_ENV });
});

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await closeRedis().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
