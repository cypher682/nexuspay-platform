import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { seedDefaultTemplates } from "./services/notifications.service";
import { startNotificationWorker, stopNotificationWorker } from "./workers/notification.worker";

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`notifications-service listening on port ${env.PORT}`, { env: env.NODE_ENV });
});

if (env.NODE_ENV !== "test") {
  void startNotificationWorker();
}

void (async () => {
  try {
    await seedDefaultTemplates();
    logger.info("notifications-service bootstrap complete");
  } catch (err) {
    logger.warn("Bootstrap incomplete at startup", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
})();

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down`);
  await stopNotificationWorker();
  server.close(async () => {
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
