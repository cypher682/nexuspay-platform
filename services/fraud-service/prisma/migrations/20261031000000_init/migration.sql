-- CreateEnum
CREATE TYPE "FraudRuleType" AS ENUM ('AMOUNT_THRESHOLD', 'VELOCITY', 'DENYLIST');

-- CreateEnum
CREATE TYPE "FraudDecision" AS ENUM ('ALLOW', 'REVIEW', 'BLOCK');

-- CreateTable
CREATE TABLE "fraud_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FraudRuleType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "score" INTEGER NOT NULL DEFAULT 50,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_checks" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "decision" "FraudDecision" NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" TEXT[],
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fraud_rules_name_key" ON "fraud_rules"("name");

-- CreateIndex
CREATE INDEX "fraud_checks_userId_createdAt_idx" ON "fraud_checks"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "fraud_checks_decision_createdAt_idx" ON "fraud_checks"("decision", "createdAt");

-- Seed default rules
INSERT INTO "fraud_rules" ("id", "name", "type", "enabled", "score", "config", "createdAt", "updatedAt")
VALUES
  ('rule_amount_threshold', 'amount_threshold', 'AMOUNT_THRESHOLD', true, 60, '{"maxAmountMinor":10000000}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule_velocity', 'velocity_5_per_5m', 'VELOCITY', true, 60, '{"windowSeconds":300,"maxChecks":5}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rule_denylist', 'denylist', 'DENYLIST', true, 100, '{"userIds":[],"emails":[]}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
