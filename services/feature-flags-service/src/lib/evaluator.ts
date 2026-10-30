import crypto from "node:crypto";

export type EvaluationReason =
  | "flag_disabled"
  | "allowlist"
  | "rollout"
  | "not_in_rollout"
  | "flag_not_found";

export interface FlagSnapshot {
  key: string;
  environment: string;
  enabled: boolean;
  rolloutPercent: number;
  variants: string[];
  allowlist: string[];
}

export interface Evaluation {
  key: string;
  subjectId: string;
  enabled: boolean;
  variant: string | null;
  reason: EvaluationReason;
}

/** Stable 32-bit bucket (0-9999) for a subject on a flag. */
export function rolloutBucket(environment: string, key: string, subjectId: string): number {
  const digest = crypto
    .createHash("sha256")
    .update(`${environment}:${key}:${subjectId}`, "utf8")
    .digest();
  return digest.readUInt32BE(0) % 10_000;
}

function pickVariant(flag: FlagSnapshot, subjectId: string): string | null {
  if (flag.variants.length === 0) return null;
  const digest = crypto
    .createHash("sha256")
    .update(`variant:${flag.environment}:${flag.key}:${subjectId}`, "utf8")
    .digest();
  return flag.variants[digest.readUInt32BE(4) % flag.variants.length] ?? null;
}

/**
 * Deterministic evaluation order:
 * 1. Master switch off -> disabled for everyone.
 * 2. Subject on the allowlist -> enabled (overrides percentage rollout).
 * 3. Subject bucket below rolloutPercent -> enabled.
 * 4. Otherwise disabled.
 */
export function evaluateFlag(flag: FlagSnapshot, subjectId: string): Evaluation {
  if (!flag.enabled) {
    return { key: flag.key, subjectId, enabled: false, variant: null, reason: "flag_disabled" };
  }

  if (flag.allowlist.includes(subjectId)) {
    return {
      key: flag.key,
      subjectId,
      enabled: true,
      variant: pickVariant(flag, subjectId),
      reason: "allowlist"
    };
  }

  const included = rolloutBucket(flag.environment, flag.key, subjectId) < flag.rolloutPercent * 100;
  return {
    key: flag.key,
    subjectId,
    enabled: included,
    variant: included ? pickVariant(flag, subjectId) : null,
    reason: included ? "rollout" : "not_in_rollout"
  };
}
