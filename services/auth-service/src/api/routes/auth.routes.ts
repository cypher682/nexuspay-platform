import { Router, type Request } from "express";
import { z } from "zod";
import {
  loginUser,
  logoutUser,
  refreshTokens,
  registerUser,
  verifyMfaChallenge
} from "../../services/auth.service";
import { HttpError } from "../../middleware/error-handler";
import { asyncHandler } from "./utils";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(10)
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[a-z]/, "Must contain a lowercase letter")
    .regex(/[0-9]/, "Must contain a digit"),
  fullName: z.string().min(1).max(120).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20)
});

const mfaVerifySchema = z.object({
  challengeToken: z.string().min(20),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits")
});

function origin(req: Request) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null
  };
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const result = await registerUser(body, origin(req));
    res.status(201).json(result);
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const result = await loginUser(body, origin(req));
    if ("mfaRequired" in result) {
      res.status(200).json({ mfaRequired: true, challengeToken: result.challengeToken });
      return;
    }
    res.json(result);
  })
);

router.post(
  "/mfa/verify",
  asyncHandler(async (req, res) => {
    const body = mfaVerifySchema.parse(req.body);
    const result = await verifyMfaChallenge(body, origin(req));
    res.json(result);
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body);
    const tokens = await refreshTokens(body.refreshToken);
    res.json(tokens);
  })
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken : undefined;
    await logoutUser(refreshToken, { ...origin(req), userId: req.auth?.userId });
    res.status(204).send();
  })
);

router.get(
  "/verify-email",
  asyncHandler(async (_req, _res) => {
    throw new HttpError(501, "Email verification flow pending integration with notifications-service");
  })
);

export default router;
