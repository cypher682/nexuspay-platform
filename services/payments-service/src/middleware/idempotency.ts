import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { env } from "../config/env";
import { HttpError } from "./error-handler";

const idempotencyHeaderSchema = z.string().min(8).max(128);

interface ReplayPayload {
  statusCode: number;
  body: unknown;
}

export function requireIdempotency(endpoint: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.auth) throw new HttpError(401, "Authentication required");

      const key = idempotencyHeaderSchema.parse(req.headers["idempotency-key"]);
      const lockKey = `nexuspay:payments:idem:${req.auth.userId}:${endpoint}:${key}`;

      const existing = await prisma.idempotencyRecord.findUnique({
        where: { key_userId_endpoint: { key, userId: req.auth.userId, endpoint } }
      });
      if (existing) {
        res.status(existing.statusCode).json(existing.responseBody as ReplayPayload["body"]);
        return;
      }

      const acquired = await redis.set(lockKey, "locked", "EX", env.PAYMENT_PROCESSING_TTL_SECONDS, "NX");
      if (!acquired) {
        const replay = await waitForReplayRecord(key, req.auth.userId, endpoint);
        if (replay) {
          res.status(replay.statusCode).json(replay.body);
          return;
        }
        throw new HttpError(409, "Request with this Idempotency-Key is already in flight");
      }

      res.locals.idempotencyLockKey = lockKey;
      res.locals.idempotencyComplete = async (statusCode: number, body: unknown): Promise<void> => {
        await prisma.idempotencyRecord.create({
          data: {
            key,
            userId: req.auth!.userId,
            endpoint,
            responseBody: body as Prisma.InputJsonValue,
            statusCode
          }
        });
        await redis.del(lockKey);
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

async function waitForReplayRecord(
  key: string,
  userId: string,
  endpoint: string
): Promise<ReplayPayload | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const record = await prisma.idempotencyRecord.findUnique({
      where: { key_userId_endpoint: { key, userId, endpoint } }
    });
    if (record) return { statusCode: record.statusCode, body: record.responseBody };
  }
  return null;
}
