import { Queue } from "bullmq";
import { initTelemetry, shutdownTelemetry } from "./lib/telemetry";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { closeRedis, bullMqConnectionOptions } from "./lib/redis";
import { refreshQueueMetrics } from "./lib/metrics";
import { closeEventPublisher } from "./lib/events";
import { QUEUES } from "./queues/names";
import { startPaymentWorker } from "./workers/payment.worker";

const SERVICE_NAME = "payments-service";
const SERVICE_VERSION = "1.1.0";

async function bootstrap(): Promise<void> {
  initTelemetry(SERVICE_NAME, SERVICE_VERSION);

  const { createApp } = await import("./app");
  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`${SERVICE_NAME} listening on port ${env.PORT}`, { env: env.NODE_ENV });
  });

  let worker: ReturnType<typeof startPaymentWorker> | undefined;
  let queue: Queue | undefined;
  let stopQueueMetrics: (() => void) | undefined;
  if (env.NODE_ENV !== "test") {
    worker = startPaymentWorker();
    if (env.METRICS_ENABLED) {
      queue = new Queue(QUEUES.paymentProcessing, { connection: bullMqConnectionOptions() });
      stopQueueMetrics = refreshQueueMetrics(queue);
    }
  }

  async function shutdown(signal: string): Promise<void> {
    logger.info(`${signal} received, shutting down`);
    stopQueueMetrics?.();
    await worker?.close().catch(() => undefined);
    await queue?.close().catch(() => undefined);
    server.close(async () => {
      await shutdownTelemetry();
      await closeEventPublisher().catch(() => undefined);
      await closeRedis().catch(() => undefined);
      await prisma.$disconnect().catch(() => undefined);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void bootstrap();