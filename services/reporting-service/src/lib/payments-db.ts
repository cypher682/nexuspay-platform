import { Pool, type QueryResultRow } from "pg";
import { env } from "../config/env";
import { logger } from "./logger";

export const paymentsPool = new Pool({
  connectionString: env.PAYMENTS_DATABASE_URL,
  max: 4,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15_000
});

paymentsPool.on("error", (err) => {
  logger.warn("payments pool error", { error: err.message });
});

export async function queryPayments<T extends QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<T[]> {
  const result = await paymentsPool.query<T>(text, values);
  return result.rows;
}
