import { Worker, type Job } from "bullmq";
import crypto from "node:crypto";
import type { Payment } from "@prisma/client";
import { bullMqConnectionOptions } from "../lib/redis";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { QUEUES } from "../queues/names";
import { markFailed, markSucceeded, markProcessing } from "../services/payments.service";

const PROVIDER_SUCCESS_PROBABILITY = 0.9;

function simulateProviderDecision(): { ok: boolean; providerRef?: string; reason?: string } {
  if (crypto.randomBytes(1)[0] / 255 < PROVIDER_SUCCESS_PROBABILITY) {
    return { ok: true, providerRef: `mock_${crypto.randomBytes(8).toString("hex")}` };
  }
  return { ok: false, reason: "provider_declined" };
}

export async function processPaymentJob(job: Job<{ paymentId: string }>): Promise<void> {
  const payment: Payment | null = await prisma.payment.findUnique({
    where: { id: job.data.paymentId }
  });

  if (!payment) {
    logger.warn("worker.payment_not_found", { paymentId: job.data.paymentId });
    return;
  }

  if (payment.status !== "PENDING" && payment.status !== "PROCESSING") {
    logger.info("worker.skipped_terminal_payment", { paymentId: payment.id, status: payment.status });
    return;
  }

  if (payment.status === "PENDING") {
    await markProcessing(payment.id);
  }

  const decision = simulateProviderDecision();
  if (decision.ok && decision.providerRef) {
    await markSucceeded(payment.id, decision.providerRef);
    return;
  }
  await markFailed(payment.id, decision.reason ?? "provider_error");
}

export function startPaymentWorker(): Worker {
  const worker = new Worker<{ paymentId: string }>(QUEUES.paymentProcessing, processPaymentJob, {
    connection: bullMqConnectionOptions(),
    concurrency: 2
  });

  worker.on("completed", (job) => logger.info("worker.job_completed", { jobId: job.id }));
  worker.on("failed", (job, err) =>
    logger.error("worker.job_failed", {
      jobId: job?.id,
      paymentId: job?.data?.paymentId,
      error: err.message
    })
  );

  return worker;
}
