import type { WebhookEvent } from "@prisma/client";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { markSucceeded, markFailed } from "./payments.service";

export async function handleWebhookEvent(event: WebhookEvent): Promise<void> {
  const payload = event.payload as Record<string, unknown>;
  const type = event.type;
  const data = (payload.data ?? {}) as Record<string, unknown>;

  if (type === "transfer.completed") {
    const reference = typeof data.reference === "string" ? data.reference : undefined;
    const providerRef = typeof data.providerRef === "string" ? data.providerRef : `webhook_${event.eventId}`;

    if (!reference) {
      logger.warn("webhook.missing_reference", { eventId: event.eventId });
      return;
    }

    const payment = await prisma.payment.findFirst({ where: { reference } });
    if (!payment) {
      logger.warn("webhook.payment_not_found", { eventId: event.eventId, reference });
      return;
    }

    if (payment.status === "SUCCEEDED" || payment.status === "REFUNDED") {
      logger.info("webhook.payment_already_terminal", { paymentId: payment.id, status: payment.status });
      return;
    }

    await markSucceeded(payment.id, providerRef);
    logger.info("webhook.payment_succeeded_via_event", { paymentId: payment.id, eventId: event.eventId });
  } else if (type === "transfer.failed") {
    const reference = typeof data.reference === "string" ? data.reference : undefined;
    const reason = typeof data.reason === "string" ? data.reason : "provider_transfer_failed";

    if (!reference) {
      logger.warn("webhook.missing_reference", { eventId: event.eventId });
      return;
    }

    const payment = await prisma.payment.findFirst({ where: { reference } });
    if (!payment) {
      logger.warn("webhook.payment_not_found", { eventId: event.eventId, reference });
      return;
    }

    if (payment.status === "SUCCEEDED" || payment.status === "REFUNDED" || payment.status === "FAILED") {
      logger.info("webhook.payment_already_terminal", { paymentId: payment.id, status: payment.status });
      return;
    }

    await markFailed(payment.id, reason);
    logger.info("webhook.payment_failed_via_event", { paymentId: payment.id, eventId: event.eventId });
  } else {
    logger.warn("webhook.unknown_event_type", { type, eventId: event.eventId });
  }
}
