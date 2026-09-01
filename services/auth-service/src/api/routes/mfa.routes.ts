import { Router } from "express";
import { z } from "zod";
import { authenticate, optionalAuthenticate } from "../../middleware/authenticate";
import { asyncHandler } from "./utils";
import { confirmMfa, disableMfa, setupMfa } from "../../services/mfa.service";

const router = Router();

router.post(
  "/setup",
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await setupMfa(req.auth!.userId);
    res.json(result);
  })
);

const confirmSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

router.post(
  "/verify",
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const body = confirmSchema.parse(req.body);

    if (req.auth) {
      const result = await confirmMfa(req.auth.userId, body.code, {
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null
      });
      res.json(result);
      return;
    }

    res.status(401).json({
      error: "mfa_confirm_requires_session",
      message: "Confirm MFA with an authenticated session; use /auth/mfa/verify to complete a login challenge"
    });
  })
);

const disableSchema = z.object({ password: z.string().min(1) });

router.post(
  "/disable",
  authenticate,
  asyncHandler(async (req, res) => {
    const body = disableSchema.parse(req.body);
    const result = await disableMfa(req.auth!.userId, body.password, {
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null
    });
    res.json(result);
  })
);

export default router;
