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
    key: "verify_email",
    channel: "EMAIL" as const,
    subject: "Verify your NexusPay email",
    body: "Hi {{fullName}}, verify your email to activate your NexusPay account: {{verifyUrl}}"
  },
  {
    key: "password_reset",
    channel: "EMAIL" as const,
    subject: "Reset your NexusPay password",
    body: "Hi {{fullName}}, you requested a password reset. Use this link within the hour: {{resetUrl}}"
  },
  {
    key: "payment_receipt_email",
    channel: "EMAIL" as const,
    subject: "Payment receipt: {{reference}}",
    body: "We received {{amountMinor}} {{currency}} for payment {{reference}}. Thank you."
  },
  {
    key: "payment_failed_email",
    channel: "EMAIL" as const,
    subject: "Payment declined: {{reference}}",
    body: "We could not process {{amountMinor}} {{currency}} for payment {{reference}}. Your funds were not charged."
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

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(422, `Domain event missing ${key}`);
  }
  return value;
}

function readOptionalUserId(payload: Record<string, unknown>): string | undefined {
  const value = payload.userId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function handleDomainEvent(
  routingKey: string,
  payload: Record<string, unknown>
): Promise<"ack" | "retry" | "reject"> {
  switch (routingKey) {
    case "payment.succeeded":
      await enqueueNotification({
        userId: readOptionalUserId(payload),
        channel: "EMAIL",
        templateKey: "payment_receipt_email",
        recipient: readString(payload, "email"),
        payload: {
          reference: readString(payload, "reference"),
          amountMinor: payload.amountMinor,
          currency: readString(payload, "currency")
        }
      });
      return "ack";

    case "payment.failed":
      await enqueueNotification({
        userId: readOptionalUserId(payload),
        channel: "EMAIL",
        templateKey: "payment_failed_email",
        recipient: readString(payload, "email"),
        payload: {
          reference: readString(payload, "reference"),
          amountMinor: payload.amountMinor,
          currency: readString(payload, "currency")
        }
      });
      return "ack";

    case "auth.user_registered":
      await enqueueNotification({
        userId: readOptionalUserId(payload),
        channel: "EMAIL",
        templateKey: "verify_email",
        recipient: readString(payload, "email"),
        payload: {
          fullName:
            typeof payload.fullName === "string" && payload.fullName.length > 0
              ? payload.fullName
              : "there",
          verifyUrl: readString(payload, "verifyUrl")
        }
      });
      return "ack";

    case "auth.password_reset":
      await enqueueNotification({
        userId: readOptionalUserId(payload),
        channel: "EMAIL",
        templateKey: "password_reset",
        recipient: readString(payload, "email"),
        payload: {
          fullName:
            typeof payload.fullName === "string" && payload.fullName.length > 0
              ? payload.fullName
              : "there",
          resetUrl: readString(payload, "resetUrl")
        }
      });
      return "ack";

    default:
      logger.warn("domain.unhandled_event", { routingKey });
      return "ack";
  }
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
