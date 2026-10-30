import { Prisma, type Flag } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { evaluateFlag, type Evaluation } from "../lib/evaluator";
import { flagChangesTotal, flagEvaluationsTotal } from "../lib/metrics";
import { HttpError } from "../middleware/error-handler";
import { logger } from "../lib/logger";

export interface FlagInput {
  key: string;
  description?: string | null;
  enabled?: boolean;
  rolloutPercent?: number;
  variants?: string[];
  allowlist?: string[];
  environment?: string;
}

export interface FlagPatch {
  description?: string | null;
  enabled?: boolean;
  rolloutPercent?: number;
  variants?: string[];
  allowlist?: string[];
}

interface AuditEntry {
  key: string;
  action: string;
  actor: string | null;
  before?: unknown;
  after?: unknown;
}

function toSnapshot(flag: Flag) {
  return {
    key: flag.key,
    environment: flag.environment,
    enabled: flag.enabled,
    rolloutPercent: flag.rolloutPercent,
    variants: flag.variants,
    allowlist: flag.allowlist
  };
}

export function serializeFlag(flag: Flag) {
  return {
    id: flag.id,
    key: flag.key,
    description: flag.description,
    enabled: flag.enabled,
    rolloutPercent: flag.rolloutPercent,
    variants: flag.variants,
    allowlist: flag.allowlist,
    environment: flag.environment,
    createdBy: flag.createdBy,
    updatedBy: flag.updatedBy,
    createdAt: flag.createdAt,
    updatedAt: flag.updatedAt
  };
}

async function audit(entry: AuditEntry, environment: string): Promise<void> {
  try {
    await prisma.flagAuditLog.create({
      data: {
        flagKey: entry.key,
        action: entry.action,
        actor: entry.actor,
        ...(entry.before !== undefined
          ? { before: entry.before as Prisma.InputJsonValue }
          : {}),
        ...(entry.after !== undefined ? { after: entry.after as Prisma.InputJsonValue } : {})
      }
    });
  } catch (err) {
    logger.warn("Failed to write flag audit log", {
      environment,
      action: entry.action,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export async function listFlags(environment: string, limit: number): Promise<Flag[]> {
  return prisma.flag.findMany({
    where: { environment },
    orderBy: { key: "asc" },
    take: limit
  });
}

export async function getFlag(key: string, environment: string): Promise<Flag> {
  const flag = await prisma.flag.findUnique({
    where: { environment_key: { environment, key } }
  });
  if (!flag) throw new HttpError(404, `Flag '${key}' not found in environment '${environment}'`);
  return flag;
}

export async function createFlag(input: FlagInput, actor: string | null): Promise<Flag> {
  const environment = input.environment ?? "prod";
  const existing = await prisma.flag.findUnique({
    where: { environment_key: { environment, key: input.key } }
  });
  if (existing) {
    throw new HttpError(409, `Flag '${input.key}' already exists in environment '${environment}'`);
  }

  const flag = await prisma.flag.create({
    data: {
      key: input.key,
      description: input.description ?? null,
      enabled: input.enabled ?? false,
      rolloutPercent: input.rolloutPercent ?? 0,
      variants: input.variants ?? [],
      allowlist: input.allowlist ?? [],
      environment,
      createdBy: actor,
      updatedBy: actor
    }
  });

  flagChangesTotal.inc({ action: "create" });
  await audit(
    { action: "create", actor, after: serializeFlag(flag), key: flag.key },
    environment
  );
  return flag;
}

export async function updateFlag(
  key: string,
  environment: string,
  patch: FlagPatch,
  actor: string | null
): Promise<Flag> {
  const before = await getFlag(key, environment);

  const flag = await prisma.flag.update({
    where: { environment_key: { environment, key } },
    data: {
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.rolloutPercent !== undefined ? { rolloutPercent: patch.rolloutPercent } : {}),
      ...(patch.variants !== undefined ? { variants: patch.variants } : {}),
      ...(patch.allowlist !== undefined ? { allowlist: patch.allowlist } : {}),
      updatedBy: actor
    }
  });

  flagChangesTotal.inc({ action: "update" });
  await audit(
    {
      action: "update",
      actor,
      before: serializeFlag(before),
      after: serializeFlag(flag),
      key
    },
    environment
  );
  return flag;
}

export async function deleteFlag(
  key: string,
  environment: string,
  actor: string | null
): Promise<void> {
  const before = await getFlag(key, environment);
  await prisma.flag.delete({ where: { environment_key: { environment, key } } });
  flagChangesTotal.inc({ action: "delete" });
  await audit({ action: "delete", actor, before: serializeFlag(before), key }, environment);
}

export async function listAudit(key: string, environment: string, limit: number) {
  await getFlag(key, environment);
  return prisma.flagAuditLog.findMany({
    where: { flagKey: key },
    orderBy: { createdAt: "desc" },
    take: limit
  });
}

export async function evaluateFlagForSubject(
  key: string,
  subjectId: string,
  environment: string
): Promise<Evaluation> {
  const flag = await prisma.flag.findUnique({
    where: { environment_key: { environment, key } }
  });

  if (!flag) {
    flagEvaluationsTotal.inc({ result: "flag_not_found" });
    return {
      key,
      subjectId,
      enabled: false,
      variant: null,
      reason: "flag_not_found"
    };
  }

  const evaluation = evaluateFlag(toSnapshot(flag), subjectId);
  flagEvaluationsTotal.inc({ result: evaluation.enabled ? "enabled" : "disabled" });
  return evaluation;
}

export async function evaluateFlagsForSubject(
  keys: string[] | undefined,
  subjectId: string,
  environment: string,
  limit: number
): Promise<Evaluation[]> {
  const flags = await prisma.flag.findMany({
    where: {
      environment,
      ...(keys && keys.length > 0 ? { key: { in: keys } } : {})
    },
    orderBy: { key: "asc" },
    take: limit
  });

  const found = new Map(flags.map((flag) => [flag.key, flag]));
  const requested = keys && keys.length > 0 ? keys : flags.map((flag) => flag.key);

  return requested.map((key) => {
    const flag = found.get(key);
    if (!flag) {
      flagEvaluationsTotal.inc({ result: "flag_not_found" });
      return {
        key,
        subjectId,
        enabled: false,
        variant: null,
        reason: "flag_not_found" as const
      };
    }
    const evaluation = evaluateFlag(toSnapshot(flag), subjectId);
    flagEvaluationsTotal.inc({ result: evaluation.enabled ? "enabled" : "disabled" });
    return evaluation;
  });
}
