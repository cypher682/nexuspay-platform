-- Reporting service: immutable snapshot tables plus a refresh run history.
CREATE TABLE "daily_payment_snapshots" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "succeededCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "refundedCount" INTEGER NOT NULL DEFAULT 0,
    "grossVolumeMinor" BIGINT NOT NULL DEFAULT 0,
    "refundedVolumeMinor" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_payment_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_payment_snapshots_day_currency_key"
    ON "daily_payment_snapshots"("day", "currency");

CREATE TABLE "report_runs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fromDay" DATE NOT NULL,
    "toDay" DATE NOT NULL,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "report_runs_startedAt_idx" ON "report_runs"("startedAt");
