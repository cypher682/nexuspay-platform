import { evaluateRules, parseRuleConfig, velocityWindowSeconds, type FraudRuleRecord } from "../src/lib/rules";

const baseRules: FraudRuleRecord[] = [
  {
    id: "1",
    name: "amount_threshold",
    type: "AMOUNT_THRESHOLD",
    enabled: true,
    score: 60,
    config: { maxAmountMinor: 1_000_000 }
  },
  {
    id: "2",
    name: "velocity",
    type: "VELOCITY",
    enabled: true,
    score: 60,
    config: { windowSeconds: 300, maxChecks: 3 }
  },
  {
    id: "3",
    name: "denylist",
    type: "DENYLIST",
    enabled: true,
    score: 100,
    config: { userIds: ["bad-user"], emails: ["Fraud@Example.com"] }
  }
];

const thresholds = { blockScore: 70, reviewScore: 40 };

function evaluate(overrides: Partial<Parameters<typeof evaluateRules>[1]> = {}, recentCount = 0) {
  return evaluateRules(
    baseRules,
    { userId: "user-1", amountMinor: 10_000, currency: "NGN", ...overrides },
    { recentCount },
    thresholds
  );
}

describe("evaluateRules", () => {
  it("allows a small payment from a clean user", () => {
    const result = evaluate();
    expect(result.decision).toBe("ALLOW");
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  it("reviews a payment above the amount threshold", () => {
    const result = evaluate({ amountMinor: 2_000_000 });
    expect(result.decision).toBe("REVIEW");
    expect(result.score).toBe(60);
    expect(result.reasons).toContain("amount_threshold");
  });

  it("blocks when amount and velocity both fire", () => {
    const result = evaluate({ amountMinor: 2_000_000 }, 3);
    expect(result.decision).toBe("BLOCK");
    expect(result.score).toBe(100);
    expect(result.reasons).toEqual(["amount_threshold", "velocity"]);
  });

  it("ignores currency-specific thresholds for other currencies", () => {
    const rules: FraudRuleRecord[] = [
      {
        id: "x",
        name: "ngn_only",
        type: "AMOUNT_THRESHOLD",
        enabled: true,
        score: 80,
        config: { maxAmountMinor: 100, currency: "NGN" }
      }
    ];
    const result = evaluateRules(
      rules,
      { userId: "u", amountMinor: 500, currency: "USD" },
      { recentCount: 0 },
      thresholds
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("blocks denylisted users regardless of score thresholds", () => {
    const result = evaluate({ userId: "bad-user" });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons).toEqual(["denylist"]);
  });

  it("matches denylisted emails case-insensitively", () => {
    const result = evaluate({ email: "fraud@example.com" });
    expect(result.decision).toBe("BLOCK");
  });

  it("skips disabled rules", () => {
    const rules = baseRules.map((rule) =>
      rule.type === "AMOUNT_THRESHOLD" ? { ...rule, enabled: false } : rule
    );
    const result = evaluateRules(
      rules,
      { userId: "user-1", amountMinor: 2_000_000, currency: "NGN" },
      { recentCount: 0 },
      thresholds
    );
    expect(result.decision).toBe("ALLOW");
  });

  it("skips malformed config instead of throwing", () => {
    const rules: FraudRuleRecord[] = [
      {
        id: "bad",
        name: "broken",
        type: "VELOCITY",
        enabled: true,
        score: 100,
        config: { maxChecks: -1 }
      }
    ];
    expect(parseRuleConfig("VELOCITY", rules[0].config)).toBeNull();
    const result = evaluateRules(
      rules,
      { userId: "u", amountMinor: 1, currency: "NGN" },
      { recentCount: 999 },
      thresholds
    );
    expect(result.decision).toBe("ALLOW");
  });
});

describe("velocityWindowSeconds", () => {
  it("uses the largest enabled velocity window", () => {
    const rules: FraudRuleRecord[] = [
      ...baseRules,
      {
        id: "4",
        name: "slow_velocity",
        type: "VELOCITY",
        enabled: true,
        score: 10,
        config: { windowSeconds: 900, maxChecks: 10 }
      }
    ];
    expect(velocityWindowSeconds(rules)).toBe(900);
  });
});
