import crypto from "node:crypto";
import { connect, type Channel, type ChannelModel } from "amqplib";
import type { Payment } from "@prisma/client";
import { env } from "../config/env";
import { logger } from "./logger";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

interface DomainEvent {
  eventId: string;
  type: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export async function getEventPublisher(retries = 5, delayMs = 2000): Promise<Channel> {
  if (channel) {
    return channel;
  }

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      connection = await connect(env.RABBITMQ_URL);
      connection.on("error", (err) => {
        logger.error("RabbitMQ connection error", { error: err.message });
        channel = null;
        connection = null;
      });
      connection.on("close", () => {
        logger.warn("RabbitMQ connection closed");
        channel = null;
        connection = null;
      });

      channel = await connection.createConfirmChannel();
      await channel.assertExchange(env.EVENTS_EXCHANGE, "topic", { durable: true });
      return channel;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn("RabbitMQ connect failed, retrying", {
        attempt,
        retries,
        error: lastError.message
      });
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

async function publish(routingKey: string, data: Record<string, unknown>): Promise<void> {
  if (env.NODE_ENV === "test") {
    return;
  }

  const ch = await getEventPublisher();
  const event: DomainEvent = {
    eventId: `evt_${crypto.randomUUID()}`,
    type: routingKey,
    occurredAt: new Date().toISOString(),
    data
  };

  ch.publish(env.EVENTS_EXCHANGE, routingKey, Buffer.from(JSON.stringify(event)), {
    persistent: true,
    contentType: "application/json",
    type: routingKey
  });
}

export async function publishPaymentSucceeded(payment: Payment): Promise<void> {
  await publish("payment.succeeded", {
    paymentId: payment.id,
    reference: payment.reference,
    userId: payment.userId,
    email: payment.recipientEmail,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    providerRef: payment.providerRef ?? undefined
  });
}

export async function publishPaymentFailed(payment: Payment): Promise<void> {
  await publish("payment.failed", {
    paymentId: payment.id,
    reference: payment.reference,
    userId: payment.userId,
    email: payment.recipientEmail,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    failureReason: payment.failureReason ?? undefined
  });
}

export async function closeEventPublisher(): Promise<void> {
  if (channel) {
    await channel.close().catch(() => undefined);
    channel = null;
  }
  if (connection) {
    await connection.close().catch(() => undefined);
    connection = null;
  }
}