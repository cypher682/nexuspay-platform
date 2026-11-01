import { Router } from "express";
import { z } from "zod";
import {
  authenticate,
  requireReportAdmin,
  requireReportReader
} from "../../middleware/authenticate";
import { asyncHandler } from "./utils";
import { listDaily, listRuns, refreshRange } from "../../services/reports.service";
import { toCsv, type DailySnapshotCsvRow } from "../../lib/csv";

const router = Router();

const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "invalid date");

function isoDay(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

const rangeSchema = z
  .object({
    from: daySchema.default(() => isoDay(-29)),
    to: daySchema.default(() => isoDay(1)),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional()
  })
  .refine((value) => value.from < value.to, "`from` must be before `to`");

const refreshSchema = z
  .object({
    from: daySchema.default(() => isoDay(-6)),
    to: daySchema.default(() => isoDay(1))
  })
  .refine((value) => value.from < value.to, "`from` must be before `to`")
  .refine(
    (value) =>
      (Date.parse(`${value.to}T00:00:00.000Z`) - Date.parse(`${value.from}T00:00:00.000Z`)) /
        86_400_000 <=
      366,
    "range must be at most 366 days"
  );

router.get(
  "/payments/daily",
  authenticate,
  requireReportReader,
  asyncHandler(async (req, res) => {
    const query = rangeSchema.parse(req.query);
    const rows = await listDaily(query.from, query.to, query.currency);
    res.json({ from: query.from, to: query.to, currency: query.currency ?? null, count: rows.length, rows });
  })
);

router.get(
  "/payments/daily.csv",
  authenticate,
  requireReportReader,
  asyncHandler(async (req, res) => {
    const query = rangeSchema.parse(req.query);
    const rows = await listDaily(query.from, query.to, query.currency);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="payments-daily-${query.from}-to-${query.to}.csv"`
    );
    res.send(toCsv(rows as DailySnapshotCsvRow[]));
  })
);

router.get(
  "/runs",
  authenticate,
  requireReportReader,
  asyncHandler(async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(100).default(20).parse(req.query.limit);
    const runs = await listRuns(limit);
    res.json({ count: runs.length, runs });
  })
);

router.post(
  "/refresh",
  authenticate,
  requireReportAdmin,
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body ?? {});
    const result = await refreshRange(body.from, body.to);
    res.status(202).json({ from: body.from, to: body.to, ...result });
  })
);

export default router;
