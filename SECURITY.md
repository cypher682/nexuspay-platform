# Security Policy

## Reporting a vulnerability

This is a **lab / educational** project. Do **not** deploy it to production or use
it with real financial data. If you find a security issue anyway:

- Open a private advisory via **GitHub Security Advisories** (preferred)
  `https://github.com/cypher682/nexuspay-platform/security/advisories`
- Or email the maintainer at the address listed on the GitHub profile.

Please include a description of the flaw, the affected component, and a minimal
reproduction. You will receive a response within 7 days.

## Disclosure

We appreciate coordinated disclosure. Please allow a reasonable fix window before
public disclosure.

## Supply-chain scanning

Dependencies are audited in CI (`npm audit --audit-level=high`) and every image
is scanned with Trivy (fail on CRITICAL, ignore unfixed). If a new scanner run
flags a package, open an issue with the advisory link.

## Scope

At this stage the project is intended for learning and portfolio review. Treat all
credentials in `.env` / `values.yaml` as development-only placeholders.