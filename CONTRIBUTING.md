# Contributing

Thanks for your interest! This repository is a learning/portfolio project, but
good contributions are welcome.

## Getting started

1. Fork the repo and clone your fork.
2. Install Node.js 20+ and Docker with Docker Compose.
3. Run the stack: `cp .env.example .env && docker compose up -d --build`
4. Apply migrations: run `npx prisma migrate deploy` in each `services/<name>/`.

## Development workflow

- Make changes in a feature branch: `git checkout -b feat/my-change`
- Keep changes focused. Format with Prettier, lint with ESLint, and typecheck
  with `tsc` (all four services).
- Add or update Jest tests where behaviour changes.
- Validate OpenAPI: `npx tsx scripts/validate-openapi.ts`
- Verify the CI-equivalent smoke test passes before opening a PR:
  `k6 run k6/smoke-test.js`

## Pull request checklist

- [ ] Commits are small and well-described
- [ ] `npm run lint` and `npx tsc --noEmit` pass in every touched service
- [ ] Tests pass (`npm test` in the touched service)
- [ ] OpenAPI spec kept in sync if routes changed
- [ ] No secrets or real `.env` files committed

## Code conventions

- TypeScript (CommonJS), Express 5, Zod for schemas, Prisma for storage, Winston for logs.
- Monetary values are integer minor units — never floats.
- Prefer small, single-purpose modules over big files.

## Questions

Open an issue or start a discussion. For security issues, see [SECURITY.md](SECURITY.md).