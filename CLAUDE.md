# Flip — Claude Code guide

> Agent orchestration protocol (worktree isolation, task classification, verification gates, hard prohibitions) lives in [`AGENTS.md`](./AGENTS.md).

Flip is a colour-mixing puzzle game. Players apply templates to a grid of pigment cells; XOR mixing of RYB primaries creates secondary colours. The goal is to clear every cell to white (pigment 0). It ships as a SvelteKit PWA with a Hono API backend, Stripe payments, and a rich puzzle-generation engine.

---

## Monorepo structure

| Path | What it is |
|------|-----------|
| `apps/app` | SvelteKit frontend (TypeScript, Vite, Tailwind CSS, Playwright e2e) |
| `apps/api` | Hono API backend (TypeScript, Node via `tsx`, Zod env validation) |
| `packages/auth` | better-auth shared config (Google OAuth) |
| `packages/db` | Drizzle ORM — schema, migrations, Supabase PostgreSQL connection |
| `packages/game` | Pure-TS puzzle engine: generation, solving, difficulty scoring, pack management, pricing |

`packages/game` is the core business logic. Before adding puzzle or pack features, check it for existing utilities — it has 50+ source files covering generation, solvability analysis, difficulty profiles, and pedagogy validation.

---

## Commands

```bash
# Dev
npm run app:dev          # SvelteKit dev server (port 5173)
npm run api:dev          # Hono API with hot-reload (port 3001)

# Database
npm run db:generate      # Generate Drizzle migrations from schema changes
npm run db:migrate       # Apply pending migrations
npm run db:push          # Push schema directly (bypasses migration tracking)
npm run db:studio        # Open Drizzle Studio

# Game / packs
npm run game:validate              # Validate all pack definitions
npm run game:generate-pack         # Generate a new pack
npm run game:report-difficulty     # Report difficulty metrics
npm run game:reorder-pack          # Re-order pack puzzles by difficulty

# Tests
npm test                 # Playwright e2e smoke suite (builds app first)
npm run test:ui          # Playwright interactive UI
npm run test:unit        # Vitest unit tests (once)
npm run test:unit:watch  # Vitest in watch mode

# Lint
npm run lint             # Run eslint on apps/app (also runs as pre-commit hook via husky)
npm run lint:fix         # Auto-fix lint issues

# Stripe
npm run stripe:listen    # Forward webhooks to localhost:5173/api/webhooks/stripe
npm run stripe:status    # Check Stripe configuration status
```

---

## Environment variables

All env vars live in a single **root `.env` file**. Each package loads it differently:

- **`apps/app`** (`vite.config.ts`): loads root `.env` via `loadEnv` and injects into `process.env` — required for `packages/auth` and `packages/db` which run server-side.
- **`packages/db`** (`drizzle.config.ts`): loads root `.env` via `dotenv` with an explicit path (`resolve(process.cwd(), '../../.env')`) — needed because drizzle-kit runs from the `packages/db` directory.
- **`apps/api`** (`env.ts`): loads root `.env` via `dotenv` in development only; in production (Lambda) env vars are injected at runtime.

Key variables:

| Variable | Where to get it |
|----------|----------------|
| `DATABASE_URL` | Supabase → Settings → Database → Connection string (port 5432, not 6543) |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Developers → Webhooks |
| `BETTER_AUTH_SECRET` | Any long random string |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console → OAuth credentials |

Run `npm run verify:auth` to confirm production auth is configured correctly.

---

## Testing

Two frameworks — use the right one for the job:

| Scenario | Framework | Command |
|----------|-----------|---------|
| UI/routing smoke tests | Playwright | `npm test` |
| Pure logic (game engine, utilities, services) | Vitest | `npm run test:unit` |

Playwright builds the app and runs against the preview server (`localhost:4173`), not the dev server. Set `CI=true` in CI environments to force a fresh build.

Unit tests live beside source files (`*.test.ts`). The `packages/game` package has extensive Vitest coverage — run it before and after changes to game logic.

After any UI change, check `apps/app/tests/smoke.test.ts` for tests that may be affected and run the suite.

---

## Core domain concepts

### Pigment system
Cells hold a 3-bit RYB bitmask (`Pigment = 0–7`):
- `0` = clear (white, solved state)
- `1` = Red, `2` = Yellow, `4` = Blue (primaries)
- `3` = Orange, `5` = Purple, `6` = Green (secondaries)
- `7` = Prism (all three primaries)

Applying a template XORs its pigment into matching cells. All types are in `packages/game/src/types.ts`.

### Packs
A `PackDefinition` has a `slug`, `name`, `access` (`free` | `paid`), and a map of puzzle configs. Pack slugs in production must be listed in `packages/game/src/productionPacks.ts`. Stripe product IDs live in API config — not in pack definitions.

Seeding behaviour is controlled by `SEED_ACTIVE_MODE`:
- `dev` — activates dev-only packs
- `production` — activates only slugs in `PRODUCTION_PACK_SLUGS`
- `all` — activates everything

`packages/db/seed.ts` is authoritative, not additive: for each pack it upserts every puzzle currently in `packDef.puzzles`, then **deletes any `puzzle` row for that pack whose `puzzleNumber` isn't in that map**. This means removing a puzzle number from source data (e.g. dropping puzzle 9 from `first-steps`) and reseeding actually deletes the stale DB row instead of leaving it orphaned. Removing a pack's slug from `PRODUCTION_PACK_SLUGS` only sets `pack.active = false` on reseed — it does not delete the pack or its puzzle rows, and does not touch any associated Stripe product/price (see Stripe integration below). After the main per-pack loop, seed.ts also deactivates (never deletes) any `pack` row whose slug isn't present in `packs.ts`'s exported array *at all* — the same orphan-pruning applied one level up, so a pack removed outright from source data doesn't stay active forever just because the loop never visits it.

Production database convergence (`db:migrate` + `db:seed:production`) runs automatically via `.github/workflows/db-sync.yml` on every push to `main` — see [Database Migration Workflow in AGENTS.md](./AGENTS.md#5-database-migration-workflow). A human no longer needs to remember to run these by hand after merging. Production applies only committed migration files under `packages/db/migrations/` (`db:migrate`, not `db:push`) — any PR touching `packages/db/schema.ts` must include the generated migration file (`npm run db:generate`) in the same PR, or the schema change silently never reaches production.

**`packs.ts` is the actual runtime data, not the hand-authored source files.** `packages/game/src/packs.ts`'s exported `packs` array is a big JSON literal — that's what `getPackBySlug`/`getPuzzleById`/`packages/db/seed.ts` read. Some packs (e.g. `simple-mono-dev`) are spliced in live via an imported variable, but others with dedicated source files under `packages/game/src/puzzles/` (e.g. `firstSteps.ts` → `firstStepsPack`, `monkey.ts` → `animalPack`) are imported *but never referenced* in that array — their JSON is a separately-maintained, hand-copied snapshot. Editing `firstSteps.ts` alone does **not** change what ships; you must also update the matching inline block in `packs.ts` (see `packages/game/scripts/sync-first-steps-packs.ts` for a splice-only script that does this without reserializing the whole file — a plain `JSON.stringify` of the full `packs` array will also flatten *live* array entries like `simpleMonoDevPack` into inline JSON, which is an unwanted structural change to unrelated packs).

**Pool-based generation (`pool` field in `packGenerationSpecs.ts`) with `kind: 'color'` is expensive — budget real time.** The pool generator (`generatePackCandidatePool` / `tryBuildScrambledCandidate` in `packPoolGeneration.ts`) solves and scores every scrambled candidate with a full BFS. For `kind: 'mono'` this is cheap regardless of depth (single bit-plane, ≤512 states on a 3×3 grid). For `kind: 'color'`, especially with `minMultiColoredTemplates` forcing a template to mix pigments, the reachable state space's rank can balloon enormously — a handful of candidates can take tens of seconds to solve instead of milliseconds. Two safeguards exist specifically for this: solve/evaluate depth is bounded by the actual `scrambleMoves.length` (not a flat pool-wide ceiling), and `POOL_SOLVE_MAX_STATES` (in `packPoolGeneration.ts`) caps BFS states explored per candidate, rejecting over-complex candidates instead of grinding on them. If you add a new `color`-kind pool spec and generation seems to hang, this is the first place to look — verify with a short standalone timed loop calling `tryBuildScrambledCandidate` directly before assuming the run just needs more time.

### Daily puzzles
`/daily` returns a procedurally generated puzzle for the current UTC date — there is no curated rotation. `dailyGenerationKind(epochDays)` (`packages/game/src/dailyGeneration.ts`) alternates `mono`/`color` by day parity, and `generateDailyPuzzle` reuses the pool generator's `tryBuildScrambledCandidate` (see the pool-generation note above) to build one scrambled puzzle. Rows live in the `daily_puzzle` table (`packages/db/schema.ts`): `generatedConfig`/`generationKind` hold the generated puzzle, while `packSlug`/`puzzleId` are now nullable and unused by new rows. Both the `/api/cron/daily-puzzles` cron and the `/api/daily` route generate-and-store on demand, skipping dates that already have a row — `npm run db:seed` seeds the lookahead window the same way, so a fresh environment never falls back to pack rotation.

### Stripe integration
Paid packs use Stripe Checkout. The API routes live in `apps/api/src/stripe/`. Pack pricing is computed in `packages/game/src/packPricing.ts` (`apps/api/src/stripe/pack-pricing.ts` just re-exports it) and is the single source `bootstrapStripe` (`apps/api/src/stripe/stripe-bootstrap.ts`) iterates to create/update Stripe products and prices. Use `npm run stripe:listen` locally to forward webhooks.

**Removing a pack's price entry from `PACK_PRICES_CENTS` does not retire its Stripe product.** `bootstrapStripe` only creates/updates products for slugs currently in the map — it never archives a product for a slug that's been removed. If a pack was previously sellable (had a live Stripe product/price via `pack.stripeProductId`), taking it off the pricing map is a code-only change; the Stripe product itself stays active until someone archives it directly in Stripe (or via a script that does), which is a live-state change requiring a human decision, not something to do unilaterally from a code change.

---

## Code conventions

- **TypeScript strict** — no `any`. Use typed errors.
- **Naming**: `camelCase` for variables/functions, `PascalCase` for types/classes/components, `UPPER_SNAKE_CASE` for top-level constants, boolean prefixes `is`/`has`/`can`/`should`.
- **File size**: target ≤300 lines; split when a file does more than one thing.
- **Prefer editing existing files** over creating new ones — check for existing utilities before adding new ones.
- **Explicit over clever**: readable code over one-liners.
- **Class/DI design**: whenever you write or change application code (features, bug fixes, refactors), invoke the `/class-di-design` skill and follow it — focused classes with constructor dependency injection, keeping the diff minimal and reviewable.
- **`.env.example` hygiene**: add/remove a key in `.env.example` every time you add/remove an env var in code.

---

## Workflow

- **Plan before coding**: for non-trivial tasks, outline the approach and confirm before making changes.
- **TDD**: write or update tests first, then implement. Run the relevant test command before finalising any change.
- **Commit style**: imperative subject line ≤50 chars with type prefix (`feat`, `fix`, `chore`, `refactor`, `test`, `docs`). One logical change per commit.
- **Feature branch + PR for everything**: never commit or push directly to `main` — every change (code, docs, config, including `CLAUDE.md`/`AGENTS.md` edits) goes on a feature branch named per the `AGENTS.md` convention (`feature/`, `fix/`, `docs/`, `scout/` …) and lands only via a reviewed PR. Merging is the owner's call; don't merge your own PRs.
- **Pull requests**: whenever you open a PR, invoke the `/create-pr` skill and follow it. PRs must be easy to understand and review: a ≤70-char title summarising the whole change, and a skimmable body with **Summary** (what and why, 1–3 sentences), **Changes** (notable changes grouped by area), and **Testing** (what was run and how to verify, or plainly "not tested"). Keep the diff focused on one change, and never commit secrets or unrelated files.
- **Security**: never commit secrets. Validate all user input. Use parameterised queries. Don't log PII.

---

## Key documentation

| File | What it covers |
|------|---------------|
| `documentation/new-app-checklist.md` | Start here when reusing this template |
| `documentation/database.md` | Drizzle + Supabase setup, env loading details |
| `documentation/testing.md` | Playwright + Vitest guide |
| `documentation/stripe.md` | Stripe integration overview |
| `documentation/stripe-live-setup.md` | Going live with Stripe |
| `documentation/vercel-deployment.md` | Production deployment |
| `documentation/git-worktrees.md` | Worktree workflow used in this project |
| `AGENTS.md` | Agent orchestration protocol (First Mate pattern) |
