import { z } from "zod";

export type FraudRuleType = "AMOUNT_THRESHOLD" | "VELOCITY" | "DENYLIST";
export type FraudDecision = "ALLOW" | "REVIEW" | "BLOCK";

export interface FraudRuleRecord {
  id: string;
  name: string;
  type: FraudRuleType;
  enabled: boolean;
  score: number;
  config: unknown;
}

export interface CheckInput {
  userId: string;
  amountMinor: number;
  currency: string;
  email?: string | null;
}

export interface CheckContext {
  recentCount: number;
}

export interface RuleHit {
  rule: string;
  type: FraudRuleType;
  reason: string;
  score: number;
}

export interface Evaluation {
  score: number;
  hits: RuleHit[];
  decision: FraudDecision;
  reasons: string[];
}

export interface DecisionThresholds {
  blockScore: number;
  reviewScore: number;
}

const amountConfig = z.object({
  maxAmountMinor: z.number().int().positive(),
  currency: z.string().length(3).optional()
});

const velocityConfig = z.object({
  windowSeconds: z.number().int().positive().max(86_400).default(300),
  maxChecks: z.number().int().positive().max(10_000)
});

const denylistConfig = z.object({
  userIds: z.array(z.string().min(1)).default([]),
  emails: z.array(z.string().min(1)).default([])
});

export type ParsedRuleConfig =
  | { type: "AMOUNT_THRESHOLD"; value: z.infer<typeof amountConfig> }
  | { type: "VELOCITY"; value: z.infer<typeof velocityConfig> }
  | { type: "DENYLIST"; value: z.infer<typeof denylistConfig> };

export function parseRuleConfig(type: FraudRuleType, config: unknown): ParsedRuleConfig | null {
  if (type === "AMOUNT_THRESHOLD") {
    const parsed = amountConfig.safeParse(config);
    return parsed.success ? { type, value: parsed.data } : null;
  }
  if (type === "VELOCITY") {
    const parsed = velocityConfig.safeParse(config);
    return parsed.success ? { type, value: parsed.data } : null;
  }
  const parsed = denylistConfig.safeParse(config);
  return parsed.success ? { type, value: parsed.data } : null;
}

export function velocityWindowSeconds(rules: FraudRuleRecord[]): number {
  let window = 300;
  for (const rule of rules) {
    if (!rule.enabled || rule.type !== "VELOCITY") continue;
    const parsed = parseRuleConfig("VELOCITY", rule.config);
    if (parsed && parsed.type === "VELOCITY") {
      window = Math.max(window, parsed.value.windowSeconds);
    }
  }
  return window;
}

export function evaluateRules(
  rules: FraudRuleRecord[],
  input: CheckInput,
  context: CheckContext,
  thresholds: DecisionThresholds
): Evaluation {
  const hits: RuleHit[] = [];
  const currency = input.currency.toUpperCase();
  const email = input.email?.trim().toLowerCase() ?? null;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const parsed = parseRuleConfig(rule.type, rule.config);
    if (!parsed) continue;

    if (parsed.type === "AMOUNT_THRESHOLD") {
      const currencyMatches =
        !parsed.value.currency || parsed.value.currency.toUpperCase() === currency;
      if (currencyMatches && input.amountMinor >= parsed.value.maxAmountMinor) {
        hits.push({ rule: rule.name, type: rule.type, reason: "amount_threshold", score: rule.score });
      }
      continue;
    }

    if (parsed.type === "VELOCITY") {
      if (context.recentCount >= parsed.value.maxChecks) {
        hits.push({ rule: rule.name, type: rule.type, reason: "velocity", score: rule.score });
      }
      continue;
    }

    const userMatch = parsed.value.userIds.includes(input.userId);
    const emailMatch =
      email !== null && parsed.value.emails.some((value) => value.toLowerCase() === email);
    if (userMatch || emailMatch) {
      hits.push({ rule: rule.name, type: rule.type, reason: "denylist", score: rule.score });
    }
  }

  const score = Math.min(
    100,
    hits.reduce((total, hit) => total + hit.score, 0)
  );
  const reasons = [...new Set(hits.map((hit) => hit.reason))];
  const denied = hits.some((hit) => hit.reason === "denylist");

  const decision: FraudDecision = denied
    ? "BLOCK"
    : score >= thresholds.blockScore
      ? "BLOCK"
      : score >= thresholds.reviewScore
        ? "REVIEW"
        : "ALLOW";

  return { score, hits, decision, reasons };
}
