import crypto from "node:crypto";
import type { Payment, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { HttpError } from "../middleware/error-handler";
import { assertTransition } from "./payment-state-machine";
import { paymentProcessingQueue } from "../queues";
import { publishPaymentFailed, publishPaymentSucceeded } from "../lib/events";

export interface CreatePaymentInput {
  userId: string;
  recipientEmail?: string;
  amountMinor: number;
  currency?: string;
  provider: "MOCK_CARD" | "MOCK_TRANSFER";
  metadata?: Record<string, unknown>;
}

export function generateReference(): string {
  return `pay_${crypto.randomBytes(10).toString("hex")}`;
}

export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new HttpError(422, "amountMinor must be a positive integer of minor units");
  }

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        reference: generateReference(),
        userId: input.userId,
        recipientEmail: input.recipientEmail ?? null,
        amountMinor: input.amountMinor,
        currency: (input.currency ?? "NGN").toUpperCase(),
        provider: input.provider,
        status: "PENDING",
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined
      }
    });
    return created;
  });

  await paymentProcessingQueue.add(
    "process-payment",
    { paymentId: payment.id },
    { jobId: payment.id, removeOnComplete: 100, removeOnFail: 200 }
  );

  logger.info("payment.created", {
    paymentId: payment.id,
    reference: payment.reference,
    userId: input.userId,
    amountMinor: payment.amountMinor
  });

  return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
}

async function applyTransition(paymentId: string, to: Payment["status"]): Promise<Payment> {
  const current = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  assertTransition(current.status, to);
  return prisma.payment.update({ where: { id: paymentId }, data: { status: to } });
}

export async function getPaymentForUser(paymentId: string, userId: string, hasWildcardScope: boolean): Promise<Payment> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { ledgerEntries: true }
  });
  if (!payment) throw new HttpError(404, "Payment not found");
  if (payment.userId !== userId && !hasWildcardScope) {
    throw new HttpError(403, "Not allowed to view this payment");
  }
  return payment;
}

export async function listPayments(
  userId: string,
  hasWildcardScope: boolean,
  limit: number,
  cursor?: string
): Promise<{ payments: Payment[]; nextCursor: string | null }> {
  const scopeFilter = hasWildcardScope ? {} : { userId };
  const decoded = decodeCursor(cursor);

  const page = await prisma.payment.findMany({
    where: decoded
      ? {
          ...scopeFilter,
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            { createdAt: decoded.createdAt, id: { lt: decoded.id } }
          ]
        }
      : scopeFilter,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1
  });

  const hasMore = page.length > limit;
  const items = hasMore ? page.slice(0, limit) : page;
  const last = items[items.length - 1];

  return {
    payments: items,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null
  };
}

interface CursorPayload {
  createdAt: Date;
  id: string;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id }), "utf8").toString("base64url");
}

function decodeCursor(cursor?: string): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt: string;
      id: string;
    };
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw new HttpError(400, "Malformed pagination cursor");
  }
}

export async function capturePayment(paymentId: string, userId: string, hasWildcardScope: boolean): Promise<Payment> {
  const payment = await getPaymentForUser(paymentId, userId, hasWildcardScope);
  if (payment.status !== "PENDING") {
    assertTransition(payment.status, "PROCESSING");
  }

  await applyTransition(paymentId, "PROCESSING");

  await paymentProcessingQueue.add(
    "process-payment",
    { paymentId },
    { jobId: `${paymentId}:capture:${Date.now()}`, removeOnComplete: 100 }
  );

  logger.info("payment.capture_requested", { paymentId });
  return prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
}

export async function markProcessing(paymentId: string): Promise<Payment> {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  assertTransition(payment.status, "PROCESSING");

  logger.info("payment.processing", { paymentId });
  return prisma.payment.update({
    where: { id: paymentId },
    data: { status: "PROCESSING" }
  });
}

export async function markSucceeded(paymentId: string, providerRef: string): Promise<Payment> {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  assertTransition(payment.status, "SUCCEEDED");

  const feeMinor = readFeeMinor(payment.metadata);

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: paymentId },
      data: { status: "SUCCEEDED", capturedAt: new Date(), providerRef }
    }),
    prisma.ledgerEntry.createMany({
      data: [
        {
          paymentId,
          account: "CUSTOMER_SOURCE",
          direction: "DEBIT",
          amountMinor: payment.amountMinor,
          currency: payment.currency
        },
        {
          paymentId,
          account: "PAYMENTS_REVENUE",
          direction: "CREDIT",
          amountMinor: payment.amountMinor - feeMinor,
          currency: payment.currency
        },
        ...(feeMinor > 0
          ? [
              {
                paymentId,
                account: "PAYMENTS_FEES" as const,
                direction: "CREDIT" as const,
                amountMinor: feeMinor,
                currency: payment.currency
              }
            ]
          : [])
      ]
    })
  ]);

  await publishPaymentSucceeded(payment)
    .catch((err) =>
      logger.warn("events.publish_failed", {
        event: "payment.succeeded",
        paymentId: payment.id,
        error: err instanceof Error ? err.message : String(err)
      })
    );

  logger.info("payment.succeeded", { paymentId, providerRef, feeMinor });
  return prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
}

export async function markFailed(paymentId: string, reason: string): Promise<Payment> {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  assertTransition(payment.status, "FAILED");

  const failed = await prisma.payment.update({
    where: { id: paymentId },
    data: { status: "FAILED", failureReason: reason }
  });

  await publishPaymentFailed(failed)
    .catch((err) =>
      logger.warn("events.publish_failed", {
        event: "payment.failed",
        paymentId: failed.id,
        error: err instanceof Error ? err.message : String(err)
      })
    );

  logger.info("payment.failed", { paymentId, reason });
  return failed;
}

export async function refundPayment(paymentId: string, userId: string, hasWildcardScope: boolean): Promise<Payment> {
  const payment = await getPaymentForUser(paymentId, userId, hasWildcardScope);
  assertTransition(payment.status, "REFUNDED");

  const refunded = await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.createMany({
      data: [
        {
          paymentId,
          account: "CUSTOMER_REFUND",
          direction: "DEBIT",
          amountMinor: payment.amountMinor,
          currency: payment.currency
        },
        {
          paymentId,
          account: "PAYMENTS_REVENUE",
          direction: "DEBIT",
          amountMinor: payment.amountMinor,
          currency: payment.currency
        }
      ]
    });
    return tx.payment.update({
      where: { id: paymentId },
      data: { status: "REFUNDED", refundedAt: new Date() }
    });
  });

  logger.info("payment.refunded", { paymentId });
  return refunded;
}

function readFeeMinor(metadata: Prisma.JsonValue | null): number {
  if (metadata && typeof metadata === "object" && "feeMinor" in metadata) {
    const raw = (metadata as Record<string, unknown>).feeMinor;
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  }
  return 0;
}
