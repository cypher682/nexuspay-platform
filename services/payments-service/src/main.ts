import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { closeRedis } from "./lib/redis";
import { startPaymentWorker } from "./workers/payment.worker";

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`payments-service listening on port ${env.PORT}`, { env: env.NODE_ENV });
});

let worker: ReturnType<typeof startPaymentWorker> | undefined;
if (env.NODE_ENV !== "test") {
  worker = startPaymentWorker();
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down`);
  await worker?.close().catch(() => undefined);
  server.close(async () => {
    await closeRedis().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
