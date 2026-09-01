import { closeRabbit, startDeadLetterConsumer, startDomainConsumer } from "../lib/rabbitmq";
import { handleDomainEvent } from "../services/notifications.service";
import { logger } from "../lib/logger";

let domainActive = false;

export async function startDomainWorker(): Promise<void> {
  try {
    await startDomainConsumer(({ routingKey, payload }) => handleDomainEvent(routingKey, payload));
    await startDeadLetterConsumer(async ({ routingKey, content }) => {
      logger.warn("notification.dead_lettered", { routingKey, content: content.slice(0, 500) });
    });
    domainActive = true;
    logger.info("notification.domain_worker_started");
  } catch (err) {
    domainActive = false;
    logger.error("notification.domain_worker_failed_to_start", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export async function stopDomainWorker(): Promise<void> {
  if (domainActive) {
    await closeRabbit().catch(() => undefined);
    domainActive = false;
    logger.info("notification.domain_worker_stopped");
  }
}