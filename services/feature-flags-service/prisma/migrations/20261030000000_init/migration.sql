-- CreateTable
CREATE TABLE "flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPercent" INTEGER NOT NULL DEFAULT 0,
    "variants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "environment" TEXT NOT NULL DEFAULT 'prod',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flag_audit_logs" (
    "id" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flag_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flags_environment_key_key" ON "flags"("environment", "key");

-- CreateIndex
CREATE INDEX "flags_environment_idx" ON "flags"("environment");

-- CreateIndex
CREATE INDEX "flag_audit_logs_flagKey_createdAt_idx" ON "flag_audit_logs"("flagKey", "createdAt");
