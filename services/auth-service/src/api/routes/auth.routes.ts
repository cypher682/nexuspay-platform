import { Router, type Request } from "express";
import { z } from "zod";
import {
  forgotPassword,
  loginUser,
  logoutUser,
  refreshTokens,
  registerUser,
  resetPassword,
  verifyEmail,
  verifyMfaChallenge
} from "../../services/auth.service";
import { asyncHandler } from "./utils";

const router = Router();

const passwordSchema = z
  .string()
  .min(10)
  .regex(/[A-Z]/, "Must contain an uppercase letter")
  .regex(/[a-z]/, "Must contain a lowercase letter")
  .regex(/[0-9]/, "Must contain a digit");

const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
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
  asyncHandler(async (req, res) => {
    const { token } = z.object({ token: z.string().min(16) }).parse(req.query);
    const result = await verifyEmail(token);
    res.json(result);
  })
);

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

router.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const body = forgotPasswordSchema.parse(req.body);
    await forgotPassword(body.email);
    res.status(202).send();
  })
);

const resetPasswordSchema = z.object({
  token: z.string().min(16),
  newPassword: passwordSchema
});

router.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const body = resetPasswordSchema.parse(req.body);
    await resetPassword(body.token, body.newPassword);
    res.status(204).send();
  })
);

export default router;
