import type { Notification, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { publishNotification } from "../lib/rabbitmq";
import { renderTemplate } from "../lib/templates";
import { getSender } from "../lib/senders";
import { HttpError } from "../middleware/error-handler";

const MAX_DELIVERY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

const DEFAULT_TEMPLATES = [
  {
    key: "welcome_email",
    channel: "EMAIL" as const,
    subject: "Welcome to NexusPay",
    body: "Hi {{fullName}}, your NexusPay account is ready."
  },
  {
    key: "payment_receipt_email",
    channel: "EMAIL" as const,
    subject: "Payment receipt: {{reference}}",
    body: "We received {{amountMinor}} {{currency}} for payment {{reference}}. Thank you."
  },
  {
    key: "otp_sms",
    channel: "SMS" as const,
    subject: "Your NexusPay code",
    body: "Your NexusPay code is {{code}}. Do not share it."
  }
];

export async function seedDefaultTemplates(): Promise<void> {
  for (const template of DEFAULT_TEMPLATES) {
    await prisma.template.upsert({
      where: { key: template.key },
      update: {},
      create: template
    });
  }
  logger.info("templates.seeded", { count: DEFAULT_TEMPLATES.length });
}

export interface EnqueueNotificationInput {
  userId?: string;
  channel: "EMAIL" | "SMS";
  templateKey: string;
  recipient: string;
  payload: Record<string, unknown>;
}

export async function enqueueNotification(input: EnqueueNotificationInput): Promise<Notification> {
  const template = await prisma.template.findUnique({
    where: { key: input.templateKey }
  });

  if (!template || template.channel !== input.channel) {
    throw new HttpError(404, `Template ${input.templateKey} not found for channel ${input.channel}`);
  }

  renderTemplate(template.body, input.payload);

  const notification = await prisma.notification.create({
    data: {
      userId: input.userId ?? null,
      channel: input.channel,
      templateKey: input.templateKey,
      recipient: input.recipient,
      payload: input.payload as Prisma.InputJsonValue
    }
  });

  await publishNotification({ notificationId: notification.id });
  logger.info("notification.enqueued", {
    notificationId: notification.id,
    channel: input.channel,
    templateKey: input.templateKey
  });

  return notification;
}

export async function processDelivery(notificationId: string): Promise<void> {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification) {
    logger.warn("worker.notification_not_found", { notificationId });
    return;
  }
  if (notification.status === "SENT") return;

  await prisma.notification.update({
    where: { id: notificationId },
    data: { status: "PROCESSING" }
  });

  const template = await prisma.template.findUnique({
    where: { key: notification.templateKey }
  });
  if (!template) {
    await failNotification(notificationId, `Template ${notification.templateKey} missing`);
    return;
  }

  let renderedBody: string;
  try {
    renderedBody = renderTemplate(template.body, notification.payload as Record<string, unknown>);
  } catch (err) {
    await failNotification(
      notificationId,
      err instanceof Error ? err.message : "template render failed"
    );
    return;
  }

  const sender = getSender(notification.channel);
  let lastError = "unknown_error";

  for (let attemptNumber = 1; attemptNumber <= MAX_DELIVERY_ATTEMPTS; attemptNumber += 1) {
    try {
      const result = await sender.send(
        notification.recipient,
        renderTemplate(template.subject, notification.payload as Record<string, unknown>),
        renderedBody
      );
      await prisma.deliveryAttempt.create({
        data: { notificationId, attemptNumber, success: true }
      });
      await prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerMessageId: result.providerMessageId,
          failureReason: null
        }
      });
      logger.info("notification.sent", { notificationId, attemptNumber });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await prisma.deliveryAttempt.create({
        data: { notificationId, attemptNumber, success: false, error: lastError }
      });
      if (attemptNumber < MAX_DELIVERY_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_BASE_DELAY_MS * attemptNumber)
        );
      }
    }
  }

  await failNotification(notificationId, lastError);
}

async function failNotification(notificationId: string, reason: string): Promise<void> {
  await prisma.notification.update({
    where: { id: notificationId },
    data: { status: "FAILED", failureReason: reason }
  });
  logger.warn("notification.failed", { notificationId, reason });
}

export async function getNotification(id: string): Promise<Notification> {
  const notification = await prisma.notification.findUnique({
    where: { id },
    include: { attempts: { orderBy: { attemptNumber: "asc" } } }
  });
  if (!notification) throw new HttpError(404, "Notification not found");
  return notification;
}

export async function listNotifications(
  limit: number,
  cursor?: string
): Promise<{ notifications: Notification[]; nextCursor: string | null }> {
  interface CursorPayload {
    createdAt: Date;
    id: string;
  }

  let decoded: CursorPayload | null = null;
  if (cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
        createdAt: string;
        id: string;
      };
      decoded = { createdAt: new Date(parsed.createdAt), id: parsed.id };
    } catch {
      throw new HttpError(400, "Malformed pagination cursor");
    }
  }

  const page = await prisma.notification.findMany({
    where: decoded
      ? {
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            { createdAt: decoded.createdAt, id: { lt: decoded.id } }
          ]
        }
      : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1
  });

  const hasMore = page.length > limit;
  const items = hasMore ? page.slice(0, limit) : page;
  const last = items[items.length - 1];

  const nextCursor =
    hasMore && last
      ? Buffer.from(
          JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id }),
          "utf8"
        ).toString("base64url")
      : null;

  return { notifications: items, nextCursor };
}
