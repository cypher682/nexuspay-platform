import { startConsumer, closeRabbit } from "../lib/rabbitmq";
import { processDelivery } from "../services/notifications.service";
import { logger } from "../lib/logger";

let consumerActive = false;

export async function startNotificationWorker(): Promise<void> {
  try {
    await startConsumer(async ({ notificationId }) => {
      await processDelivery(notificationId);
    });
    consumerActive = true;
    logger.info("notification.worker_started");
  } catch (err) {
    consumerActive = false;
    logger.error("notification.worker_failed_to_start", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export async function stopNotificationWorker(): Promise<void> {
  if (consumerActive) {
    await closeRabbit().catch(() => undefined);
    consumerActive = false;
    logger.info("notification.worker_stopped");
  }
}

export function isNotificationWorkerActive(): boolean {
  return consumerActive;
}
