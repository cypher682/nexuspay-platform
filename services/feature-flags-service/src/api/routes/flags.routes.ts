import { Router } from "express";
import { z } from "zod";
import { authenticate, requireFlagAdmin } from "../../middleware/authenticate";
import { asyncHandler } from "./utils";
import {
  createFlag,
  deleteFlag,
  evaluateFlagForSubject,
  evaluateFlagsForSubject,
  getFlag,
  listAudit,
  listFlags,
  serializeFlag,
  updateFlag
} from "../../services/flags.service";

const router = Router();

const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9._-]{1,63}$/, "must start with a letter and use a-z, 0-9, dot, dash or underscore");

const environmentSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,31}$/)
  .default("prod");

const variantsSchema = z.array(z.string().min(1).max(64)).max(10);
const allowlistSchema = z.array(z.string().min(1).max(128)).max(500);

const createSchema = z.object({
  key: keySchema,
  description: z.string().max(280).nullable().optional(),
  enabled: z.boolean().optional(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
  variants: variantsSchema.optional(),
  allowlist: allowlistSchema.optional(),
  environment: environmentSchema.optional()
});

const updateSchema = z
  .object({
    description: z.string().max(280).nullable().optional(),
    enabled: z.boolean().optional(),
    rolloutPercent: z.number().int().min(0).max(100).optional(),
    variants: variantsSchema.optional(),
    allowlist: allowlistSchema.optional()
  })
  .refine((body) => Object.keys(body).length > 0, "At least one field is required");

const listQuerySchema = z.object({
  environment: environmentSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

const evaluateSchema = z.object({
  subjectId: z.string().min(1).max(128).optional(),
  context: z.record(z.string(), z.unknown()).optional()
});

const batchSchema = z.object({
  keys: z.array(keySchema).max(100).optional(),
  subjectId: z.string().min(1).max(128).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  environment: environmentSchema.optional()
});

function subjectFor(req: { auth?: { userId: string } }, requested?: string): string {
  return requested ?? req.auth?.userId ?? "anonymous";
}

router.get(
  "/",
  authenticate,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const flags = await listFlags(query.environment, query.limit);
    res.json({
      environment: query.environment,
      count: flags.length,
      flags: flags.map(serializeFlag)
    });
  })
);

router.post(
  "/evaluate",
  authenticate,
  asyncHandler(async (req, res) => {
    const body = batchSchema.parse(req.body ?? {});
    const environment = body.environment ?? "prod";
    const evaluations = await evaluateFlagsForSubject(
      body.keys,
      subjectFor(req, body.subjectId),
      environment,
      100
    );
    res.json({ environment, evaluations });
  })
);

router.get(
  "/:key",
  authenticate,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const flag = await getFlag(req.params.key, query.environment);
    res.json(serializeFlag(flag));
  })
);

router.post(
  "/",
  authenticate,
  requireFlagAdmin,
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const flag = await createFlag(body, req.auth?.userId ?? null);
    res.status(201).json(serializeFlag(flag));
  })
);

router.patch(
  "/:key",
  authenticate,
  requireFlagAdmin,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const body = updateSchema.parse(req.body);
    const flag = await updateFlag(req.params.key, query.environment, body, req.auth?.userId ?? null);
    res.json(serializeFlag(flag));
  })
);

router.delete(
  "/:key",
  authenticate,
  requireFlagAdmin,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    await deleteFlag(req.params.key, query.environment, req.auth?.userId ?? null);
    res.status(204).send();
  })
);

router.get(
  "/:key/audit",
  authenticate,
  requireFlagAdmin,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const entries = await listAudit(req.params.key, query.environment, query.limit);
    res.json({ count: entries.length, entries });
  })
);

router.post(
  "/:key/evaluate",
  authenticate,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const body = evaluateSchema.parse(req.body ?? {});
    const evaluation = await evaluateFlagForSubject(
      req.params.key,
      subjectFor(req, body.subjectId),
      query.environment
    );
    res.json(evaluation);
  })
);

export default router;
