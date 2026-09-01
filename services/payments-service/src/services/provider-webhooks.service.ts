import crypto from "node:crypto";
import type { WebhookEvent, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { HttpError } from "../middleware/error-handler";

const webhookPayloadSchema = z.object({
  eventId: z.string().min(4),
  type: z.string().min(3),
  data: z.record(z.string(), z.unknown()).optional()
});

export function verifyProviderSignature(rawBody: Buffer, signatureHeader: string | undefined): void {
  if (!signatureHeader?.startsWith("sha256=")) {
    throw new HttpError(401, "Missing or malformed webhook signature");
  }

  const presented = signatureHeader.slice("sha256=".length);
  const expected = crypto
    .createHmac("sha256", env.PROVIDER_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, "Invalid webhook signature");
  }
}

export async function ingestWebhook(rawBody: Buffer, signatureHeader?: string): Promise<WebhookEvent> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new HttpError(400, "Webhook body must be valid JSON");
  }
  const payload = webhookPayloadSchema.parse(parsed);

  let signatureValid = true;
  try {
    verifyProviderSignature(rawBody, signatureHeader);
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 401) {
      signatureValid = false;
      await prisma.webhookEvent.create({
        data: {
          eventId: payload.eventId,
          type: payload.type,
          signatureValid,
          payload: payload as Prisma.InputJsonValue
        }
      });
      throw new HttpError(401, "Invalid webhook signature");
    }
    throw err;
  }

  const existing = await prisma.webhookEvent.findUnique({ where: { eventId: payload.eventId } });
  if (existing) {
    return existing;
  }

  return prisma.webhookEvent.create({
    data: {
      eventId: payload.eventId,
      type: payload.type,
      signatureValid,
      payload: payload as Prisma.InputJsonValue
    }
  });
}

export async function markEventProcessed(eventId: string): Promise<void> {
  await prisma.webhookEvent.update({
    where: { eventId },
    data: { processedAt: new Date() }
  });
}
