import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "./utils";
import { prisma } from "../../lib/prisma";

const router = Router();

const upsertSchema = z.object({
  key: z.string().min(1).max(64),
  channel: z.enum(["EMAIL", "SMS"]),
  subject: z.string().min(1).max(200),
  body: z.string().min(1)
});

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const templates = await prisma.template.findMany({ orderBy: { key: "asc" } });
    res.json({ templates });
  })
);

router.get(
  "/:key",
  asyncHandler(async (req, res) => {
    const template = await prisma.template.findUnique({
      where: { key: z.string().min(1).parse(req.params.key) }
    });
    if (!template) {
      res.status(404).json({ error: "not_found", message: "Template not found" });
      return;
    }
    res.json(template);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = upsertSchema.parse(req.body);
    const template = await prisma.template.upsert({
      where: { key: body.key },
      update: { channel: body.channel, subject: body.subject, body: body.body },
      create: body
    });
    res.status(201).json(template);
  })
);

export default router;
