import { prisma } from "../lib/prisma";
import { queryPayments } from "../lib/payments-db";
import { logger } from "../lib/logger";
import { reportRefreshTotal, reportRowsWrittenTotal } from "../lib/metrics";

export interface DailySnapshotDto {
  day: string;
  currency: string;
  succeededCount: number;
  failedCount: number;
  refundedCount: number;
  grossVolumeMinor: string;
  refundedVolumeMinor: string;
}

interface PaymentAggregateRow {
  day: string;
  currency: string;
  succeeded_count: string;
  failed_count: string;
  refunded_count: string;
  gross_volume_minor: string;
  refunded_volume_minor: string;
}

const AGGREGATE_SQL = `
  SELECT
    to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
    "currency" AS currency,
    COUNT(*) FILTER (WHERE "status" IN ('SUCCEEDED', 'REFUNDED'))::text AS succeeded_count,
    COUNT(*) FILTER (WHERE "status" = 'FAILED')::text AS failed_count,
    COUNT(*) FILTER (WHERE "status" = 'REFUNDED')::text AS refunded_count,
    COALESCE(SUM("amountMinor") FILTER (WHERE "status" IN ('SUCCEEDED', 'REFUNDED')), 0)::text
      AS gross_volume_minor,
    COALESCE(SUM("amountMinor") FILTER (WHERE "status" = 'REFUNDED'), 0)::text
      AS refunded_volume_minor
  FROM "payments"
  WHERE "createdAt" >= $1::date
    AND "createdAt" < $2::date
  GROUP BY 1, 2
  ORDER BY 1 ASC, 2 ASC
`;

function utcDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function serialize(row: {
  day: Date;
  currency: string;
  succeededCount: number;
  failedCount: number;
  refundedCount: number;
  grossVolumeMinor: bigint;
  refundedVolumeMinor: bigint;
}): DailySnapshotDto {
  return {
    day: row.day.toISOString().slice(0, 10),
    currency: row.currency,
    succeededCount: row.succeededCount,
    failedCount: row.failedCount,
    refundedCount: row.refundedCount,
    grossVolumeMinor: row.grossVolumeMinor.toString(),
    refundedVolumeMinor: row.refundedVolumeMinor.toString()
  };
}

export async function refreshRange(
  from: string,
  toExclusive: string
): Promise<{ runId: string; rowsWritten: number }> {
  const run = await prisma.reportRun.create({
    data: {
      status: "RUNNING",
      fromDay: utcDay(from),
      toDay: utcDay(toExclusive)
    }
  });

  try {
    const rows = await queryPayments<PaymentAggregateRow>(AGGREGATE_SQL, [from, toExclusive]);

    let rowsWritten = 0;
    for (const row of rows) {
      const data = {
        succeededCount: Number(row.succeeded_count),
        failedCount: Number(row.failed_count),
        refundedCount: Number(row.refunded_count),
        grossVolumeMinor: BigInt(row.gross_volume_minor),
        refundedVolumeMinor: BigInt(row.refunded_volume_minor)
      };
      await prisma.dailyPaymentSnapshot.upsert({
        where: { day_currency: { day: utcDay(row.day), currency: row.currency } },
        create: { day: utcDay(row.day), currency: row.currency, ...data },
        update: data
      });
      rowsWritten += 1;
    }

    await prisma.reportRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", rowsWritten, finishedAt: new Date() }
    });
    reportRefreshTotal.inc({ status: "succeeded" });
    reportRowsWrittenTotal.inc(rowsWritten);
    logger.info("reporting snapshot refreshed", { from, toExclusive, rowsWritten, runId: run.id });
    return { runId: run.id, rowsWritten };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.reportRun
      .update({
        where: { id: run.id },
        data: { status: "FAILED", error: message.slice(0, 500), finishedAt: new Date() }
      })
      .catch(() => undefined);
    reportRefreshTotal.inc({ status: "failed" });
    throw err;
  }
}

export async function listDaily(
  from: string,
  toExclusive: string,
  currency?: string
): Promise<DailySnapshotDto[]> {
  const rows = await prisma.dailyPaymentSnapshot.findMany({
    where: {
      day: { gte: utcDay(from), lt: utcDay(toExclusive) },
      ...(currency ? { currency } : {})
    },
    orderBy: [{ day: "asc" }, { currency: "asc" }]
  });
  return rows.map(serialize);
}

export async function listRuns(limit: number): Promise<
  Array<{
    id: string;
    status: string;
    fromDay: string;
    toDay: string;
    rowsWritten: number;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  }>
> {
  const runs = await prisma.reportRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit
  });
  return runs.map((run) => ({
    id: run.id,
    status: run.status,
    fromDay: run.fromDay.toISOString().slice(0, 10),
    toDay: run.toDay.toISOString().slice(0, 10),
    rowsWritten: run.rowsWritten,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null
  }));
}
