import type { PaymentStatus } from "@prisma/client";
import { HttpError } from "../middleware/error-handler";

const allowedTransitions: Record<PaymentStatus, PaymentStatus[]> = {
  INITIATED: ["PENDING", "FAILED"],
  PENDING: ["PROCESSING", "FAILED"],
  PROCESSING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: ["REFUNDED"],
  FAILED: [],
  REFUNDED: []
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw new HttpError(409, `Illegal payment status transition from ${from} to ${to}`);
  }
}
