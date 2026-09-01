import type { ReconciliationRun } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { logger } from "../lib/logger";

export async function startReconciliationRun(): Promise<ReconciliationRun> {
  const run = await prisma.reconciliationRun.create({ data: { status: "RUNNING" } });

  const payments = await prisma.payment.findMany({
    where: { status: { in: ["SUCCEEDED", "REFUNDED"] } },
    include: { ledgerEntries: true }
  });

  let mismatchCount = 0;
  const mismatches: Array<{ paymentId: string; debits: number; credits: number }> = [];

  for (const payment of payments) {
    const debits = payment.ledgerEntries
      .filter((e) => e.direction === "DEBIT")
      .reduce((sum, e) => sum + e.amountMinor, 0);
    const credits = payment.ledgerEntries
      .filter((e) => e.direction === "CREDIT")
      .reduce((sum, e) => sum + e.amountMinor, 0);

    if (Math.abs(debits - credits) > env.RECONCILIATION_TOLERANCE_MINOR) {
      mismatchCount += 1;
      mismatches.push({ paymentId: payment.id, debits, credits });
    }
  }

  const finished = await prisma.reconciliationRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED",
      finishedAt: new Date(),
      totalChecked: payments.length,
      mismatchCount,
      details: mismatches.length > 0 ? { mismatches } : undefined
    }
  });

  logger.info("reconciliation.completed", {
    runId: run.id,
    totalChecked: payments.length,
    mismatchCount
  });

  return finished;
}

export async function listRuns(limit = 20): Promise<ReconciliationRun[]> {
  return prisma.reconciliationRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit
  });
}
