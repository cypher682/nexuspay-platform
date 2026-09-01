#!/usr/bin/env tsx
/**
 * Placeholder for OpenAPI auto-generation from Zod schemas.
 *
 * Phase 1: Validates the existing hand-maintained spec.
 * Phase 6: Will use zod-openapi to auto-generate from code.
 *
 * Usage: npx tsx scripts/generate-openapi.ts
 */

import { execSync } from "node:child_process";

console.log("📝 Running OpenAPI spec validation...\n");

try {
  execSync("npx tsx scripts/validate-openapi.ts", {
    cwd: __dirname + "/..",
    stdio: "inherit",
  });
} catch {
  process.exit(1);
}
