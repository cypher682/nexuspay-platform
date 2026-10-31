import type { FraudCheck, FraudDecision, FraudRule, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { HttpError } from "../middleware/error-handler";
import {
  evaluateRules,
  parseRuleConfig,
  velocityWindowSeconds,
  type CheckInput,
  type FraudRuleRecord
} from "../lib/rules";
import { incrementVelocity } from "../lib/redis";
import { env } from "../config/env";
import {
  fraudChecksTotal,
  fraudRuleHitsTotal,
  fraudVelocityErrorsTotal
} from "../lib/metrics";

export interface CheckRequest extends CheckInput {
  paymentId?: string | null;
}

export interface CheckResult {
  id: string;
  paymentId: string | null;
  userId: string;
  decision: FraudDecision;
  score: number;
  reasons: string[];
  latencyMs: number;
  createdAt: Date;
}

function toRuleRecord(rule: FraudRule): FraudRuleRecord {
  return {
    id: rule.id,
    name: rule.name,
    type: rule.type,
    enabled: rule.enabled,
    score: rule.score,
    config: rule.config
  };
}

export async function listRules(): Promise<FraudRule[]> {
  return prisma.fraudRule.findMany({ orderBy: { name: "asc" } });
}

export interface RulePatch {
  enabled?: boolean;
  score?: number;
  config?: unknown;
}

export async function updateRule(id: string, patch: RulePatch): Promise<FraudRule> {
  const existing = await prisma.fraudRule.findUnique({ where: { id } });
  if (!existing) {
    throw new HttpError(404, "Fraud rule not found");
  }

  if (patch.config !== undefined && !parseRuleConfig(existing.type, patch.config)) {
    throw new HttpError(422, "Rule config does not match its type");
  }
  if (patch.score !== undefined && (patch.score < 0 || patch.score > 100)) {
    throw new HttpError(422, "score must be between 0 and 100");
  }

  const updated = await prisma.fraudRule.update({
    where: { id },
    data: {
      enabled: patch.enabled,
      score: patch.score,
      config: patch.config as Prisma.InputJsonValue | undefined
    }
  });

  logger.info("fraud.rule_updated", { ruleId: id, fields: Object.keys(patch) });
  return updated;
}

async function recentCheckCount(userId: string, windowSeconds: number): Promise<number> {
  try {
    return await incrementVelocity(userId, windowSeconds);
  } catch (err) {
    fraudVelocityErrorsTotal.inc();
    logger.warn("fraud.velocity_unavailable", {
      userId,
      error: err instanceof Error ? err.message : String(err)
    });
    return 0;
  }
}

export async function checkPayment(input: CheckRequest): Promise<CheckResult> {
  const startedAt = Date.now();
  const rules = await listRules();
  const windowSeconds = velocityWindowSeconds(rules.map(toRuleRecord));
  const recentCount = await recentCheckCount(input.userId, windowSeconds);

  const evaluation = evaluateRules(
    rules.map(toRuleRecord),
    {
      userId: input.userId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      email: input.email
    },
    { recentCount },
    { blockScore: env.FRAUD_BLOCK_SCORE, reviewScore: env.FRAUD_REVIEW_SCORE }
  );

  const latencyMs = Date.now() - startedAt;
  const record = await prisma.fraudCheck.create({
    data: {
      paymentId: input.paymentId ?? null,
      userId: input.userId,
      email: input.email ?? null,
      amountMinor: input.amountMinor,
      currency: input.currency.toUpperCase(),
      decision: evaluation.decision,
      score: evaluation.score,
      reasons: evaluation.reasons,
      latencyMs
    }
  });

  fraudChecksTotal.inc({ decision: evaluation.decision });
  for (const hit of evaluation.hits) {
    fraudRuleHitsTotal.inc({ rule: hit.rule });
  }

  logger.info("fraud.checked", {
    checkId: record.id,
    paymentId: input.paymentId ?? null,
    userId: input.userId,
    decision: evaluation.decision,
    score: evaluation.score,
    reasons: evaluation.reasons,
    latencyMs
  });

  return {
    id: record.id,
    paymentId: record.paymentId,
    userId: record.userId,
    decision: record.decision,
    score: record.score,
    reasons: record.reasons,
    latencyMs: record.latencyMs,
    createdAt: record.createdAt
  };
}

export interface CheckQuery {
  limit: number;
  decision?: FraudDecision;
}

export async function listChecks(query: CheckQuery): Promise<FraudCheck[]> {
  return prisma.fraudCheck.findMany({
    where: query.decision ? { decision: query.decision } : undefined,
    orderBy: { createdAt: "desc" },
    take: query.limit
  });
}

export interface FraudStats {
  since: Date;
  total: number;
  byDecision: Record<string, number>;
  averageLatencyMs: number;
}

export async function stats(): Promise<FraudStats> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [total, grouped, latency] = await Promise.all([
    prisma.fraudCheck.count({ where: { createdAt: { gte: since } } }),
    prisma.fraudCheck.groupBy({
      by: ["decision"],
      where: { createdAt: { gte: since } },
      _count: { _all: true }
    }),
    prisma.fraudCheck.aggregate({
      where: { createdAt: { gte: since } },
      _avg: { latencyMs: true }
    })
  ]);

  const byDecision: Record<string, number> = { ALLOW: 0, REVIEW: 0, BLOCK: 0 };
  for (const row of grouped) {
    byDecision[row.decision] = row._count._all;
  }

  return {
    since,
    total,
    byDecision,
    averageLatencyMs: Math.round(latency._avg.latencyMs ?? 0)
  };
}
