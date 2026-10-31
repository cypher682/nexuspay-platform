import { env } from "../config/env";
import { logger } from "./logger";

export type FraudDecision = "ALLOW" | "REVIEW" | "BLOCK";

export interface FraudResult {
  id: string;
  decision: FraudDecision;
  score: number;
  reasons: string[];
}

export interface FraudCheckInput {
  paymentId: string;
  userId: string;
  amountMinor: number;
  currency: string;
  email?: string | null;
}

export async function checkFraud(input: FraudCheckInput): Promise<FraudResult | null> {
  try {
    const response = await fetch(`${env.FRAUD_SERVICE_URL}/v1/fraud/check`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-api-key": env.INTERNAL_API_KEY
      },
      body: JSON.stringify({
        paymentId: input.paymentId,
        userId: input.userId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        ...(input.email ? { email: input.email } : {})
      }),
      signal: AbortSignal.timeout(env.FRAUD_CHECK_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`fraud service responded ${response.status}`);
    }

    return (await response.json()) as FraudResult;
  } catch (err) {
    logger.warn("fraud.check_unavailable", {
      paymentId: input.paymentId,
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}
