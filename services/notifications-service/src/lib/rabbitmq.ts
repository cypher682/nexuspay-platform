import amqp, { type Channel, type ChannelModel } from "amqplib";
import { env } from "../config/env";
import { logger } from "./logger";

export const DLX_EXCHANGE = "nexuspay.dlx";
export const DLQ_NAME = "nexuspay.notifications.dead";
export const DOMAIN_QUEUE_NAME = "nexuspay.events.domain";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

export async function getChannel(retries = 5, delayMs = 2000): Promise<Channel> {
  if (channel) {
    return channel;
  }

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      connection = await amqp.connect(env.RABBITMQ_URL);
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
      await channel.assertExchange(DLX_EXCHANGE, "topic", { durable: true });

      await channel.assertQueue(env.QUEUE_NAME, {
        durable: true,
        arguments: {
          "x-dead-letter-exchange": DLX_EXCHANGE,
          "x-dead-letter-routing-key": "notification.dead"
        }
      });
      await channel.assertQueue(DLQ_NAME, { durable: true });
      await channel.bindQueue(DLQ_NAME, DLX_EXCHANGE, "#");

      await channel.assertQueue(DOMAIN_QUEUE_NAME, { durable: true });
      await channel.bindQueue(DOMAIN_QUEUE_NAME, env.EVENTS_EXCHANGE, "payment.#");
      await channel.bindQueue(DOMAIN_QUEUE_NAME, env.EVENTS_EXCHANGE, "auth.#");
      return channel;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn("RabbitMQ connect failed, retrying", { attempt, retries, error: lastError.message });
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError;
}

export async function publishNotification(message: { notificationId: string }): Promise<void> {
  const ch = await getChannel();
  ch.sendToQueue(env.QUEUE_NAME, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    contentType: "application/json"
  });
}

export async function startConsumer(
  handler: (message: { notificationId: string }) => Promise<void>
): Promise<void> {
  const ch = await getChannel();
  await ch.prefetch(10);
  await ch.consume(env.QUEUE_NAME, async (msg) => {
    if (!msg) {
      return;
    }
    try {
      const parsed = JSON.parse(msg.content.toString()) as { notificationId: string };
      await handler(parsed);
      ch.ack(msg);
    } catch (err) {
      logger.error("Notification processing failed", {
        error: err instanceof Error ? err.message : String(err)
      });
      ch.nack(msg, false, false);
    }
  });
  logger.info(`RabbitMQ consumer started on queue ${env.QUEUE_NAME}`);
}

export async function startDomainConsumer(
  handler: (event: {
    routingKey: string;
    payload: Record<string, unknown>;
  }) => Promise<"ack" | "retry" | "reject">
): Promise<void> {
  const ch = await getChannel();
  await ch.prefetch(10);
  await ch.consume(DOMAIN_QUEUE_NAME, async (msg) => {
    if (!msg) {
      return;
    }
    let payload: Record<string, unknown>;
    try {
      const raw = JSON.parse(msg.content.toString()) as { data?: Record<string, unknown> };
      payload = raw.data ?? {};
    } catch (err) {
      logger.error("domain.poison_message", {
        routingKey: msg.fields.routingKey,
        error: err instanceof Error ? err.message : String(err)
      });
      ch.nack(msg, false, false);
      return;
    }
    try {
      const action = await handler({ routingKey: msg.fields.routingKey, payload });
      if (action === "reject") {
        ch.nack(msg, false, false);
        return;
      }
      if (action === "retry") {
        ch.nack(msg, false, true);
        return;
      }
      ch.ack(msg);
    } catch (err) {
      logger.error("domain.processing_failed", {
        routingKey: msg.fields.routingKey,
        error: err instanceof Error ? err.message : String(err)
      });
      ch.nack(msg, false, false);
    }
  });
  logger.info(`Domain consumer started on queue ${DOMAIN_QUEUE_NAME}`);
}

export async function startDeadLetterConsumer(
  handler: (message: { routingKey: string; content: string }) => Promise<void>
): Promise<void> {
  const ch = await getChannel();
  await ch.prefetch(10);
  await ch.consume(DLQ_NAME, async (msg) => {
    if (!msg) {
      return;
    }
    try {
      await handler({ routingKey: msg.fields.routingKey, content: msg.content.toString() });
      ch.ack(msg);
    } catch (err) {
      logger.error("deadletter.processing_failed", {
        routingKey: msg.fields.routingKey,
        error: err instanceof Error ? err.message : String(err)
      });
      ch.ack(msg);
    }
  });
  logger.info(`Dead-letter consumer started on queue ${DLQ_NAME}`);
}

export async function closeRabbit(): Promise<void> {
  if (channel) {
    await channel.close().catch(() => undefined);
    channel = null;
  }
  if (connection) {
    await connection.close().catch(() => undefined);
    connection = null;
  }
}