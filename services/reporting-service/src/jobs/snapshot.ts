import { env } from "../config/env";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { paymentsPool } from "../lib/payments-db";
import { refreshRange } from "../services/reports.service";

function isoDay(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const from = isoDay(-env.SNAPSHOT_DAYS);
  const to = isoDay(1);
  logger.info("snapshot job starting", { from, to, days: env.SNAPSHOT_DAYS });
  const result = await refreshRange(from, to);
  logger.info("snapshot job finished", result);
}

main()
  .catch((err) => {
    logger.error("snapshot job failed", {
      error: err instanceof Error ? err.message : String(err)
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await paymentsPool.end().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  });
