import { Router } from "express";
import { asyncHandler } from "./utils";
import { ingestWebhook, markEventProcessed } from "../../services/provider-webhooks.service";
import { handleWebhookEvent } from "../../services/webhook-handler.service";

const router = Router();

router.post(
  "/provider",
  asyncHandler(async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));

    const signatureHeader = req.headers["x-nexuspay-signature"];
    const event = await ingestWebhook(
      rawBody,
      typeof signatureHeader === "string" ? signatureHeader : undefined
    );

    try {
      await handleWebhookEvent(event);
      if (!event.processedAt) {
        await markEventProcessed(event.eventId);
      }
    } catch (err) {
      const logger = (await import("../../lib/logger")).logger;
      logger.error("webhook.handler_failed", {
        eventId: event.eventId,
        error: err instanceof Error ? err.message : String(err)
      });
    }

    res.status(202).json({ received: true, eventId: event.eventId });
  })
);

export default router;
