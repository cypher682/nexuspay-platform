import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "./utils";
import { enqueueNotification, getNotification, listNotifications } from "../../services/notifications.service";

const router = Router();

const createSchema = z.object({
  userId: z.string().min(1).optional(),
  channel: z.enum(["EMAIL", "SMS"]),
  templateKey: z.string().min(1),
  recipient: z.string().min(3),
  payload: z.record(z.string(), z.unknown())
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const notification = await enqueueNotification(body);
    res.status(202).json({ id: notification.id, status: notification.status });
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).default(20),
        cursor: z.string().optional()
      })
      .parse(req.query);
    const result = await listNotifications(query.limit, query.cursor);
    res.json(result);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const notification = await getNotification(z.string().min(1).parse(req.params.id));
    res.json(notification);
  })
);

export default router;
