import { initTelemetry, shutdownTelemetry } from "./lib/telemetry";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { seedDefaultTemplates } from "./services/notifications.service";
import { startNotificationWorker, stopNotificationWorker } from "./workers/notification.worker";

const SERVICE_NAME = "notifications-service";
const SERVICE_VERSION = "1.1.0";

async function bootstrap(): Promise<void> {
  initTelemetry(SERVICE_NAME, SERVICE_VERSION);

  const { createApp } = await import("./app");
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`${SERVICE_NAME} listening on port ${env.PORT}`, { env: env.NODE_ENV });
  });

  if (env.NODE_ENV !== "test") {
    void startNotificationWorker();
  }

  try {
    await seedDefaultTemplates();
    logger.info("notifications-service bootstrap complete");
  } catch (err) {
    logger.warn("Bootstrap incomplete at startup", {
      error: err instanceof Error ? err.message : String(err)
    });
  }

  async function shutdown(signal: string): Promise<void> {
    logger.info(`${signal} received, shutting down`);
    await stopNotificationWorker();
    server.close(async () => {
      await shutdownTelemetry();
      await prisma.$disconnect().catch(() => undefined);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void bootstrap();
