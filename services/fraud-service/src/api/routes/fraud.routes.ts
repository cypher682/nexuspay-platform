import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "./utils";
import { authenticate, requireFraudAdmin, requireInternalKey } from "../../middleware/authenticate";
import { checkPayment, listChecks, listRules, stats, updateRule } from "../../services/fraud.service";

const router = Router();

const checkSchema = z.object({
  paymentId: z.string().min(1).max(64).optional(),
  userId: z.string().min(1).max(128),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3).default("NGN"),
  email: z.string().email().max(320).optional()
});

const rulePatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    score: z.number().int().min(0).max(100).optional(),
    config: z.unknown().optional()
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

const decisionSchema = z.enum(["ALLOW", "REVIEW", "BLOCK"]);

function idParam(value: string | string[] | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Invalid rule id");
  }
  return value;
}

router.post(
  "/check",
  requireInternalKey,
  asyncHandler(async (req, res) => {
    const input = checkSchema.parse(req.body);
    const result = await checkPayment(input);
    res.status(201).json(result);
  })
);

router.get(
  "/checks",
  authenticate,
  requireFraudAdmin,
  asyncHandler(async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit);
    const decision =
      req.query.decision === undefined
        ? undefined
        : decisionSchema.parse(req.query.decision);
    const checks = await listChecks({ limit, decision });
    res.json({ count: checks.length, checks });
  })
);

router.get(
  "/stats",
  authenticate,
  requireFraudAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await stats());
  })
);

router.get(
  "/rules",
  authenticate,
  requireFraudAdmin,
  asyncHandler(async (_req, res) => {
    const rules = await listRules();
    res.json({ count: rules.length, rules });
  })
);

router.patch(
  "/rules/:id",
  authenticate,
  requireFraudAdmin,
  asyncHandler(async (req, res) => {
    const id = idParam(req.params.id);
    const patch = rulePatchSchema.parse(req.body);
    const rule = await updateRule(id, patch);
    res.json(rule);
  })
);

export default router;
