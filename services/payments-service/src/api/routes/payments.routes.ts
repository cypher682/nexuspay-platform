import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireIdempotency } from "../../middleware/idempotency";
import { asyncHandler, hasWildcardScope } from "./utils";
import { HttpError } from "../../middleware/error-handler";
import {
  capturePayment,
  createPayment,
  getPaymentForUser,
  listPayments,
  refundPayment
} from "../../services/payments.service";

const router = Router();

const createSchema = z.object({
  amountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  provider: z.enum(["MOCK_CARD", "MOCK_TRANSFER"]),
  metadata: z.record(z.string(), z.unknown()).optional()
});

router.post(
  "/",
  authenticate,
  requireIdempotency("POST:/v1/payments"),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const payment = await createPayment({
      ...body,
      userId: req.auth!.userId,
      recipientEmail: req.auth?.email
    });

    if (typeof res.locals.idempotencyComplete === "function") {
      await res.locals.idempotencyComplete(201, payment);
    }
    res.status(201).json(payment);
  })
);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional()
});

router.get(
  "/",
  authenticate,
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const result = await listPayments(
      req.auth!.userId,
      hasWildcardScope(req),
      query.limit,
      query.cursor
    );
    res.json(result);
  })
);

router.get(
  "/:id",
  authenticate,
  asyncHandler(async (req, res) => {
    const payment = await getPaymentForUser(
      z.string().min(1).parse(req.params.id),
      req.auth!.userId,
      hasWildcardScope(req)
    );
    res.json(payment);
  })
);

router.post(
  "/:id/capture",
  authenticate,
  asyncHandler(async (req, res) => {
    const payment = await capturePayment(
      z.string().min(1).parse(req.params.id),
      req.auth!.userId,
      hasWildcardScope(req)
    );
    res.json(payment);
  })
);

router.post(
  "/:id/refund",
  authenticate,
  asyncHandler(async (req, res) => {
    if (!hasWildcardScope(req) && !req.auth!.scopes.includes("payments:refund")) {
      throw new HttpError(403, "Missing required permission: payments:refund");
    }
    const payment = await refundPayment(
      z.string().min(1).parse(req.params.id),
      req.auth!.userId,
      hasWildcardScope(req)
    );
    res.json(payment);
  })
);

export default router;
