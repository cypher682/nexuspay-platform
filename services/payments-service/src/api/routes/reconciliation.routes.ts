import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { asyncHandler, hasWildcardScope } from "./utils";
import { HttpError } from "../../middleware/error-handler";
import { listRuns, startReconciliationRun } from "../../services/reconciliation.service";

const router = Router();

const recentRuns = new Map<string, number>();
const RECONCILIATION_COOLDOWN_MS = 60_000;

router.post(
  "/runs",
  authenticate,
  asyncHandler(async (req, res) => {
    if (!hasWildcardScope(req) && !req.auth!.scopes.includes("reconciliation:run")) {
      throw new HttpError(403, "Missing required permission: reconciliation:run");
    }

    const lastRun = recentRuns.get(req.auth!.userId);
    if (lastRun && Date.now() - lastRun < RECONCILIATION_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((RECONCILIATION_COOLDOWN_MS - (Date.now() - lastRun)) / 1000);
      throw new HttpError(429, `Reconciliation rate limited. Try again in ${waitSeconds}s`);
    }

    const run = await startReconciliationRun();
    recentRuns.set(req.auth!.userId, Date.now());
    res.status(201).json(run);
  })
);

router.get(
  "/runs",
  authenticate,
  asyncHandler(async (_req, res) => {
    const runs = await listRuns();
    res.json({ runs });
  })
);

export default router;
