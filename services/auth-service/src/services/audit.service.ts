import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export interface AuditEventInput {
  eventType: string;
  userId?: string | null;
  status?: "success" | "failure" | "locked" | "warning";
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  const data: Prisma.AuditLogCreateInput = {
    eventType: input.eventType,
    status: input.status ?? "success",
    ipAddress: input.ipAddress ?? undefined,
    userAgent: input.userAgent ?? undefined,
    metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    ...(input.userId ? { user: { connect: { id: input.userId } } } : {})
  };

  await prisma.auditLog.create({ data });
}
