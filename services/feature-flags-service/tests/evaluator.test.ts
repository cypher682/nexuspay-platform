import { evaluateFlag, rolloutBucket } from "../src/lib/evaluator";

const base = {
  key: "checkout-redesign",
  environment: "prod",
  enabled: true,
  rolloutPercent: 0,
  variants: [] as string[],
  allowlist: [] as string[]
};

describe("feature flag evaluator", () => {
  it("returns disabled when the master switch is off, even for allowlisted subjects", () => {
    const result = evaluateFlag({ ...base, enabled: false, allowlist: ["user-1"] }, "user-1");
    expect(result).toMatchObject({ enabled: false, variant: null, reason: "flag_disabled" });
  });

  it("excludes everyone at 0% rollout without allowlist entries", () => {
    const result = evaluateFlag({ ...base, rolloutPercent: 0 }, "user-1");
    expect(result).toMatchObject({ enabled: false, variant: null, reason: "not_in_rollout" });
  });

  it("includes everyone at 100% rollout", () => {
    const result = evaluateFlag({ ...base, rolloutPercent: 100 }, "user-1");
    expect(result).toMatchObject({ enabled: true, reason: "rollout" });
  });

  it("lets the allowlist override percentage rollout", () => {
    const result = evaluateFlag({ ...base, rolloutPercent: 0, allowlist: ["user-42"] }, "user-42");
    expect(result).toMatchObject({ enabled: true, reason: "allowlist" });
  });

  it("is deterministic for the same subject and stable across calls", () => {
    const first = rolloutBucket("prod", "checkout-redesign", "user-7");
    const second = rolloutBucket("prod", "checkout-redesign", "user-7");
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(10_000);
  });

  it("changes the bucket across environments so staging can differ from prod", () => {
    expect(rolloutBucket("prod", "checkout-redesign", "user-7")).not.toBe(
      rolloutBucket("staging", "checkout-redesign", "user-7")
    );
  });

  it("assigns a stable variant from the configured list", () => {
    const flag = { ...base, rolloutPercent: 100, variants: ["control", "treatment-a", "treatment-b"] };
    const first = evaluateFlag(flag, "user-9");
    const second = evaluateFlag(flag, "user-9");
    expect(first.variant).not.toBeNull();
    expect(flag.variants).toContain(first.variant as string);
    expect(second.variant).toBe(first.variant);
  });

  it("has no variant when none are configured", () => {
    const result = evaluateFlag({ ...base, rolloutPercent: 100 }, "user-9");
    expect(result.variant).toBeNull();
  });
});
