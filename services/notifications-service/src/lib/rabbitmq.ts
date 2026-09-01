import amqp, { type Channel, type ChannelModel } from "amqplib";
import { env } from "../config/env";
import { logger } from "./logger";

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
      await channel.assertQueue(env.QUEUE_NAME, { durable: true });
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
