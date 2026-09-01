#!/usr/bin/env tsx
/**
 * Validates that docs/openapi.yaml covers all routes defined in the service source code.
 * This catches "spec drift" — routes added to code but not documented.
 *
 * Usage: npx tsx scripts/validate-openapi.ts
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

const ROOT = path.resolve(__dirname, "..");
const SPEC_PATH = path.join(ROOT, "docs", "openapi.yaml");
const SERVICES_DIR = path.join(ROOT, "services");

interface SpecRoute {
  method: string;
  path: string;
}

function extractRoutesFromSpec(): SpecRoute[] {
  const raw = fs.readFileSync(SPEC_PATH, "utf-8");
  const spec = yaml.parse(raw) as { paths?: Record<string, Record<string, unknown>> };
  const routes: SpecRoute[] = [];

  if (!spec.paths) return routes;

  for (const [p, methods] of Object.entries(spec.paths)) {
    for (const method of Object.keys(methods)) {
      if (["get", "post", "put", "patch", "delete", "head", "options"].includes(method)) {
        routes.push({ method: method.toUpperCase(), path: p });
      }
    }
  }
  return routes;
}

function extractRoutesFromCode(): SpecRoute[] {
  const routes: SpecRoute[] = [];
  const serviceDirs = fs.readdirSync(SERVICES_DIR).filter((d) =>
    fs.statSync(path.join(SERVICES_DIR, d)).isDirectory()
  );

  for (const svc of serviceDirs) {
    const routesDir = path.join(SERVICES_DIR, svc, "src", "api", "routes");
    if (!fs.existsSync(routesDir)) continue;

    const routeFiles = fs.readdirSync(routesDir).filter((f) => f.endsWith(".routes.ts"));

    for (const file of routeFiles) {
      const content = fs.readFileSync(path.join(routesDir, file), "utf-8");

      // Match router.get("/path", ...), router.post("/path", ...) etc.
      const routeRegex = /router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
      let match;
      while ((match = routeRegex.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        let codePath = match[2];

        // Normalize path params: :id → {id}
        codePath = codePath.replace(/:(\w+)/g, "{$1}");

        // Prefix with /v1/<service-prefix> based on the v1.ts router mounting
        // This is approximate — adjust prefixes as needed
        const prefixes: Record<string, string> = {
          "auth.routes.ts": "/v1/auth",
          "users.routes.ts": "/v1/users",
          "mfa.routes.ts": "/v1/mfa",
          "payments.routes.ts": "/v1/payments",
          "webhooks.routes.ts": "/v1/webhooks",
          "reconciliation.routes.ts": "/v1/reconciliation",
          "notifications.routes.ts": "/v1/notifications",
          "templates.routes.ts": "/v1/templates",
          "health.routes.ts": "/health",
        };

        const prefix = prefixes[file] ?? `/v1/${svc.replace("-service", "")}`;

        // Special-case health routes: they're mounted under /health
        let fullPath: string;
        if (file === "health.routes.ts") {
          fullPath = codePath === "/" ? "/health" : `/health${codePath}`;
        } else {
          fullPath = prefix === "/health" ? codePath : `${prefix}${codePath === "/" ? "" : codePath}`;
        }

        routes.push({ method, path: fullPath });
      }
    }
  }

  return routes;
}

function normalizePath(p: string): string {
  // strip trailing slash except root, collapse duplicates
  if (p === "/") return p;
  let out = p.replace(/\/+/g, "/");
  while (out.length > 1 && out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
}

function main() {
  console.log("📋 Validating OpenAPI spec against source code routes...\n");

  const specRoutes = extractRoutesFromSpec().map((r) => ({
    method: r.method,
    path: normalizePath(r.path),
  }));
  const codeRoutes = extractRoutesFromCode().map((r) => ({
    method: r.method,
    path: normalizePath(r.path),
  }));

  console.log(`  Spec routes:   ${specRoutes.length}`);
  console.log(`  Code routes:   ${codeRoutes.length}\n`);

  const specSet = new Set(specRoutes.map((r) => `${r.method} ${r.path}`));
  const codeSet = new Set(codeRoutes.map((r) => `${r.method} ${r.path}`));

  const missingInSpec = codeRoutes.filter((r) => !specSet.has(`${r.method} ${r.path}`));
  const missingInCode = specRoutes.filter((r) => !codeSet.has(`${r.method} ${r.path}`));

  // Gateway routes composed inline in v1.ts (not in a *.routes.ts file) are
  // expected to exist in the spec but not be found by file-scraping.
  const expectedGatewayRoutes = new Set(["GET /v1/me/summary"]);
  const missingInCodeReal = missingInCode.filter(
    (r) => !expectedGatewayRoutes.has(`${r.method} ${r.path}`)
  );

  let failed = false;

  if (missingInSpec.length > 0) {
    console.log("⚠️  Routes in code but MISSING from OpenAPI spec:");
    for (const r of missingInSpec) {
      console.log(`   ${r.method} ${r.path}`);
    }
    console.log();
    failed = true;
  }

  if (missingInCodeReal.length > 0) {
    console.log("⚠️  Routes in spec but NOT FOUND in code (stale?):");
    for (const r of missingInCodeReal) {
      console.log(`   ${r.method} ${r.path}`);
    }
    console.log();
    failed = true;
  }

  if (!failed) {
    console.log("✅ All code routes are documented in the OpenAPI spec.\n");
  } else {
    console.log("❌ Spec drift detected. Update docs/openapi.yaml or the route files.\n");
    process.exit(1);
  }
}

main();
