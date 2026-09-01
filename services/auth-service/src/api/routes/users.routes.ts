import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { authenticate } from "../../middleware/authenticate";
import { requirePermissions } from "../../middleware/require-permissions";
import { asyncHandler } from "./utils";
import { HttpError } from "../../middleware/error-handler";

const router = Router();

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        isVerified: true,
        mfaEnabled: true,
        createdAt: true,
        roles: { include: { role: { select: { name: true } } } }
      }
    });
    if (!user) throw new HttpError(404, "User not found");

    res.json({ ...user, roles: user.roles.map((r) => r.role.name) });
  })
);

const updateSchema = z.object({
  fullName: z.string().min(1).max(120).optional()
});

router.patch(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.auth!.userId },
      data: body,
      select: { id: true, email: true, fullName: true, updatedAt: true }
    });
    res.json(user);
  })
);

router.get(
  "/",
  authenticate,
  requirePermissions("users:read"),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, status: true, isVerified: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    res.json({ users });
  })
);

router.get(
  "/audit-logs",
  authenticate,
  requirePermissions("audit:read"),
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        eventType: z.string().optional(),
        userId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50)
      })
      .parse(req.query);

    const logs = await prisma.auditLog.findMany({
      where: {
        ...(query.eventType ? { eventType: query.eventType } : {}),
        ...(query.userId ? { userId: query.userId } : {})
      },
      orderBy: { createdAt: "desc" },
      take: query.limit
    });
    res.json({ logs });
  })
);

export default router;
