# Generation Engine Overhaul: 3×3 Puzzles with 3×3 Lenses

> **Status:** planning spike (no production behavior changed).
> **Benchmark script:** `packages/game/scripts/benchmark-pack-generation.ts` (read-only, never writes `packs.ts`).
> **Scope:** `packages/game`. This is a plan for **streamlining how new puzzles and packs are created**. Already-created puzzles (shipped packs, stored daily puzzles) and the daily generator are **out of scope and stay untouched** (see §0).

---

## 0. Scope

**In scope:** a new 3×3-board / 3×3-lens creation engine (generation, exact verification, triviality and fun gates, difficulty scoring) and the designer tooling around it. The goal is to get from "I want a pack like X" to a reviewed, committed 10-puzzle pack in under a minute.

**Out of scope (owner decision, revised on PR #22):**
- Migrating, regenerating, re-slugging, freezing, or deleting any existing pack. Player progress (`puzzleProgress`, `savedGameState`) is not touched.
- Changing daily puzzles. `generateDailyPuzzle` and its use of `tryBuildScrambledCandidate` stay as they are.
- Changing runtime gameplay code (hints, `Puzzle.svelte`, the API).
- Removing the legacy generators. They stay in place; the daily generator depends on `packPoolGeneration.ts`. New packs simply stop being created with them.

**Compatibility constraint:** the new engine emits the existing `PuzzleConfig` shape (`startState`, `templates`, `solvedValue`, `minMovesToSolve`) unchanged. Its extra metadata (metrics, witness solution, recipe, seed) goes in a separate sidecar, never into `PuzzleConfig`. Every puzzle already stored in `packs.ts` or the `daily_puzzle` table must keep loading and playing exactly as it does today, through the current `normalizePuzzleConfig` / `parseStoredPuzzle` paths. Nothing gets converted.

### Assumptions (owner to confirm; each one is yes/no)

1. New puzzles use a 3×3 board, and every lens is 3×3, so a lens has exactly one position per rotation (no translation).
2. Rotations are 0/90/180/270° only. There is no mirroring.
3. A move XORs the lens into the board, and lenses can be reused without limit. The player wins when the board is clear, and using every lens is not required.
4. A puzzle uses 2–4 lenses.
5. Color packs put only primaries (R/Y/B) on lenses; secondaries appear only on the board.
6. A pack is 10 puzzles ordered easy → hard, created offline by a designer CLI (not generated at runtime).
7. "Trivial" means any of: min moves ≤ 1, more than one minimal solution set, a greedy player wins > 50% of the time, a lens unused by the minimal solution, < 2 overlap cells (for 3+ moves), or < 5 coloured cells (§4.1).
8. Every new puzzle has exactly one minimal solution set.
9. Until player telemetry exists, difficulty is the weighted formula in §4.3 (min moves, decision bits, rotations, overlap, color mixing, greedy failure), tuned by internal play-tests.
10. `minMovesToSolve` is emitted as the exact optimum.
11. Output stays the existing `PuzzleConfig` format, with extra metadata in a sidecar file. Existing packs, daily puzzles, and player progress are untouched.

---

## TL;DR

1. **On a 3×3 board, a 3×3 lens has exactly one legal position per orientation.** A move is just *(lens, rotation)*, so a puzzle with `k` lenses has at most `4k` distinct placements (≤ 12 for 3 lenses). Moves are XOR: they commute and cancel in pairs. A solution is therefore a **subset** of those placements, not a sequence.
2. That makes the **whole solution space of a lens set enumerable in one pass**: 2^12 = 4,096 subsets for 3 lenses, using one integer XOR per step on a 27-bit board. That single pass returns exact `minMoves`, the number of minimal solution sets, and one witness solution **for every reachable start state at once**. Generation and verification become the same operation.
3. **Baseline (measured):** a 10-puzzle 3×3 pack takes **0.08–0.27 s (mono pool)**, **2–6 s (color slots)**, and **9.7–60 s (color pool)**, and the color-pool time swings widely from run to run. In the color pool, 80–90% of the time goes to the forgiveness DFS that counts ordered paths (`countSolutionPaths`). That count mostly measures `k!` move orderings, not real alternatives.
4. **Prototype (measured, same script):** the subset-enumeration engine with all the proposed triviality filters built **10-puzzle mono and color packs in 4–19 ms**, with a worst single puzzle of 12 ms. That is about **3,000× under** the 60 s target.
5. **Evidence that creation needs quality gates:** 15 of the 50 puzzles in production `monochrome` solve in **one move**, and 18 of 50 have a lens the minimal solution never uses. Today's creation pipeline has no check that catches either. This is cited as evidence only; **no action is planned on existing packs**.
6. Define **trivial** and **fun** with exact, cheap metrics: unique minimal set, min moves, greedy-player win rate, overlap cells, lens usage, decision bits. All of them fall out of the subset enumeration (see §4).
7. **Creation workflow:** a single `game:create-pack` command takes a recipe or `--like=<slug>`, prints a review report, supports deterministic per-slot rerolls, and writes the pack only on `--write`. It completes in seconds (§6), and the implementation plan is S0–S12 (§7).

---

## 1. Today's generation pipeline

### 1.1 Mechanics that matter for design (from the code)

| Fact | Where |
|---|---|
| Cells are 3-bit RYB pigments. A move XORs the lens pigment into each active cell, and the puzzle is solved when every cell is `0`. | `types.ts`, `PuzzleFunctions.ts` → `applyTemplate`, `isSolved` |
| Lenses rotate in 90° steps. Symmetric orientations are deduplicated. | `templatePigment.ts` → `orientTemplate`, `getDistinctTemplateOrientations` |
| Placement is snapped to the nearest in-bounds top-left. On 3×3/3×3 that is always `(0,0)`. | `apps/app/src/lib/utils/templateSnap.ts` → `getSnapToCenterPosition`, `PuzzleFunctions.ts` → `getValidPositions` |
| Lenses can be reused without limit. The win condition is a cleared grid only; "use every lens" is tracked but optional. | `Puzzle.svelte` (`usedTemplateMask`), `PuzzleFunctions.ts` → `isPuzzleComplete` |
| `minMovesToSolve` is a par for the optimal-solve badge and seeds the hint search depth. | `types.ts`, `Puzzle.svelte` → `handleHint` |
| Hints run a runtime BFS for the first move of a shortest path. | `PuzzleHint.ts` → `findHintMove` |
| The algebra: the state is in GF(2)^27 (three bit-layers × 9 cells), and each placement is a fixed vector. | `puzzleSolvability.ts` → `buildMoveMatrix`, `encodeStateDelta` |

### 1.2 Entry points

| Entry point | Algorithm | Called by | Still used? |
|---|---|---|---|
| `generateVerifiedPuzzle` (`PuzzleGenerator.ts`) | Random templates (`buildGeneratorTemplates`) + random scramble of exactly `targetMinMoves`. BFS must confirm `min == target`, and `shortestSolutionUsesAllTemplates` must hold. Retries up to `maxAttempts`. | `generation/slotGeneration.ts` → `generateVerifiedPuzzleForSlot` (slot strategy); `scripts/generate-color-pack.ts`; regen slot constants | **Yes, offline only.** Packs with `puzzles: [...]` slot specs (`tutorial-auto`…`expert-auto`, `color-spectrum`, `chromatic-ascent`, `color-ladder`) |
| `generatePackFromPoolSpec` (`packPoolGeneration.ts`) | Scramble until shortest-solution grid coverage > 2/3 (`solutionGridCoverage.ts`), plus up to 3 extra moves. BFS solve capped at `POOL_SOLVE_MAX_STATES = 20_000`. `fast` difficulty pass, then sort; `standard` (forgiveness) pass on the top 3×N, then sort by `compositeDifficulty`. | `generation/packStrategies.ts` → `poolPackStrategy` | **Yes, offline.** `monochrome`, `multicolor` (production), `grid-4x4-dev` |
| `tryBuildScrambledCandidate` (`packPoolGeneration.ts`) | One pool candidate, as above | `dailyGeneration.ts` → `generateDailyPuzzle` | **Yes, at runtime in production.** `apps/api/src/daily/daily.routes.ts` (on-demand), `apps/api/src/cron/cron.routes.ts` (lookahead), `packages/db/seed.ts` |
| `generatePackDefinition` / `generatePackFromSpec` (`generation/packStrategies.ts`) | Strategy dispatch: pool first, then slot | `scripts/generate-pack.ts` (`npm run game:generate-pack`), `regenerate-auto-packs.ts` | Yes, offline |
| `generateSimplePuzzle` (`simplePuzzleGeneration.ts`) | Already **3×3 lenses only**. Canonical lens pool (`buildCanonicalTemplatePool`) + random distinct moves, then BFS `min == M` and a DFS for exactly one solution set of size M. | `scripts/generate-simple-dev-pack.ts` → `puzzles/simpleMonoDev.ts`; `scripts/test-simple-generation.ts` | Dev pack `simple-mono-dev` only. **The closest ancestor of the proposed engine.** |
| `getValidPuzzle` (`PuzzleValidator.ts`) | Unverified random puzzle | Exported from `index.ts`; no production caller found | Legacy |

### 1.3 Solvability, difficulty, and quality checks

| Concern | Implementation | Notes |
|---|---|---|
| **Min moves** | `puzzleSearchSession.ts` → `findMinMovesBfs` (`puzzleSolver.ts` → `solveMinMoves`). String-keyed `Set<string>` of grids, depth 12 (`searchBudget.ts`). | Used everywhere: generators, difficulty, forgiveness, validate-packs, puzzle lab |
| **Solvability proof** | `puzzleSolvability.ts` → `analyzeSolvability` (GF(2) rank, nullity, `isStartSolvable`) | Exposed through `generation/solvabilityAnalyzer.ts`, but **not used by default generation** (`GenerationServices.solvability` is optional) |
| **Difficulty** | `puzzleDifficulty.ts` → `evaluatePuzzleDifficulty`: one search session plus **two more BFS passes** to find out whether rotation is required, then `puzzleForgiveness.ts` pillars → `compositeDifficulty` | Formula documented in `docs/difficulty-scoring.md`. Profiles in `generation/difficultyProfiles.ts`. Plugin variant in `generation/difficultyMetrics.ts` + `composableDifficultyEvaluator.ts` |
| **Forgiveness** | `evaluateForgivenessMetrics`. Its `countSolutionPaths` runs an **exhaustive DFS over ordered paths**, capped at 1,000, and runs unconditionally on 3×3 whenever forgiveness is on. | Dominant cost (see §5) |
| **Cognitive** | `puzzleEntropy.ts` → `computeMuse` (MUSE, `full` profile only) | Offline research |
| **Pool ranking** | `generation/candidateScoring.ts` (composite + rotation-reuse penalty − scramble overshoot) | |
| **Quality / triviality** | Scattered. `templateShape.ts` (≥2 active cells, full 2×2 mono), `templateContainment.ts` (no lens contained in another), `simplePuzzleGeneration.ts` → `hasTooSimilarTemplates` (Hamming distance), `solutionGridCoverage.ts` (shortest solution covers ≥ 2/3 of the grid), `puzzleCanonical.ts` (dedup), `generation/pedagogy*` (concept rules, not wired in by default) | **There is no `puzzleQuality.ts`.** Only `puzzleQuality.test.ts` exists, and it tests the modules listed here. Nothing rejects one-move puzzles or redundant lenses in the pool path. |
| **Validation** | `scripts/validate-packs.ts` (`npm run game:validate`) | BFS solvability on every pack |

### 1.4 Who uses what (packs, daily, dev packs)

| Consumer | Pack / feature | Generator | 3×3 board / 3×3 lenses? |
|---|---|---|---|
| Production (`productionPacks.ts`) | `first-steps` | Hand-authored (`puzzles/firstSteps.ts`, with a snapshot copied into `packs.ts`) | 8 of 8 |
| | `monochrome` | Pool (`templateSizeOptions: [3]`) | 50 of 50 |
| | `multicolor` | Pool (shape sizes 2–3) | **2 of 50** |
| | Daily (`/api/daily`, cron, seed) | `tryBuildScrambledCandidate`. Mono config is 3×3-only; color config mixes sizes. | Mono days yes, color days mostly no |
| Dev (`devPacks.ts`) | `chromatic-ascent`, `color-ladder` | Slot | Mixed sizes |
| | `grid-4x4-dev` | Pool, 4×4 | No |
| | `simple-mono-dev` | `generateSimplePuzzle` | Yes |
| Neither (archived in DB) | `tutorial-auto`…`expert-auto`, `color-spectrum`, `intro-pack`, `medium`, `hard-in-3`, `color-lab`, `animal-portraits` | Slot or hand-authored | Mixed |
| Runtime, non-generation | Hints (`findHintMove`), puzzle lab (`apps/app/src/lib/utils/puzzleLab.ts` → `solveMinMoves`) | BFS | n/a |

### 1.5 Ideas worth keeping from `wip/generation-in-progress`

| WIP item | Verdict |
|---|---|
| `puzzleAlgebraicSolver.ts`: Gaussian elimination, particular solution + kernel basis, Gray-code min-weight scan, `minimalSolutionCount` | **Keep the idea.** It is the general (any grid size) form of the proposal. On 3×3/3×3 the kernel scan and full subset enumeration have the same cost (≤ 2^12), and full enumeration also gives *every* start state's answer in the same pass, which generation needs. Keep it as the **independent cross-check verifier**. |
| `minimalSolutionCount` (minimal **sets**) vs `shortestSolutionCount` (ordered **paths**) | **Keep, and treat it as the core uniqueness metric.** It confirms the measurement in §5: the path count is inflated by `k!` (observed values 2, 6, 24, 240 = 2!, 3!, 4!, 5!·2). |
| `gf2RowReduce` exported, `PlacementMove` carrying `templateIndex` / `rotation` | Keep; it fits the new core |
| `AlgebraicDifficultyEvaluator` / `AlgebraicMinMovesSolver` with BFS fallback | Would speed up the legacy pool path, but changing legacy generation is out of scope here, so this is not planned. Not needed in the new engine. Its own doc notes the tie-break caveat: metrics computed from the specific chosen solution can differ from BFS when nullity > 0. The new engine avoids that by **requiring a unique minimal set**. |
| `report-pack-nullity.ts` | Keep as a diagnostic. Nullity becomes a reported metric (a lens-set "flexibility" signal). |
| `scripts/lib/packsSourceSplice.ts` (splice one pack instead of re-serializing `packs.ts`) | **Keep.** The new CLI needs it so it doesn't flatten live entries like `simpleMonoDevPack` (also noted in `CLAUDE.md`). |
| `playtest-colors-dev` / `algebraic-timing-test-dev` pool specs | Not needed. New packs come from `Pack3x3Recipe` (§3) rather than pool specs. |
| Swapping `defaultGenerationServices` to the algebraic implementations | Not needed. The new engine does not route through `GenerationServices`, and leaving the default alone keeps daily generation untouched. |

---

## 2. Key insight: 3×3 with 3×3 lenses is a subset problem

- Grid `N = 3` and lens `3×3` give `getValidPositions` = `[(0,0)]`. Each lens therefore contributes ≤ 4 placements, one per distinct orientation.
- Board state is `s ∈ GF(2)^27`: bit `i` = red layer of cell `i`, bit `9+i` = yellow, bit `18+i` = blue. It fits in a single JS integer.
- Applying a placement is `s ^= v_p`. Two applications cancel, and order is irrelevant. **Every solution is a subset `S ⊆ P` with `XOR(v_p, p∈S) = s₀`**, and `minMoves = min |S|`.
- So for a lens set, a single Gray-code walk over all `2^|P|` subsets (one XOR and one popcount per step) builds `Map<state, {minMoves, minSetCount, totalSetCount, witnessMask}>` for **every reachable start state**. This is the "solution space table" (SST).
- Sizes: 3 lenses → ≤ 12 placements → ≤ 4,096 subsets. 4 lenses → ≤ 65,536. 5 lenses → ≤ 1,048,576 (tens of ms; not yet measured). Every reachable state has exactly `2^nullity` preimages, so nullity can be read off the table: `nullity = |P| − log₂(|table|)`.
- **Cost for the player:** there is no positional choice. Gameplay is choosing *which lenses* and *which rotations*. The fun has to come from rotation reasoning, overlap (cells touched by several lenses), and color decomposition. The criteria in §4 target exactly those.

For new 3×3 puzzles, this means no BFS, depth caps, `maxStatesVisited`, string-keyed grids, scramble policies, or retry budgets.

---

## 3. Target architecture

New module folder `packages/game/src/engine3x3/`. Each file is small, and each class takes its collaborators by constructor injection (per `CLAUDE.md` → `/class-di-design`).

```
LensCatalog ──► LensSetSampler ──► SolutionSpaceEnumerator ──► CandidateSelector ──► PackAssembler ──► PackWriter
                                          │                          │                    │
                                          ▼                          ▼                    ▼
                                   PuzzleMetrics            TrivialityFilter        DifficultyModel
                                          │
                                          ▼
                                  IndependentVerifier (BFS / algebraic cross-check)
```

| Component | Responsibility | Notes |
|---|---|---|
| `bitboard.ts` | `Vec` encoding, `lensToVec`, `rotateLens`, `placementsFor(lenses)`, `dirtyCells`, `popcount`, plus `PuzzleConfig` ↔ `Vec` conversion | Pure functions. Unit-tested for equivalence with `applyTemplate` on random inputs. |
| `LensCatalog` | Canonical lenses under rotation, filtered by active-cell bounds, palette, and "no containment" (reuse `templateContainment.ts`) | Mono: **139** rotation classes of non-empty 3×3 masks (measured), so the catalog is precomputed and lens triples (C(139,3) ≈ 438k) can be enumerated offline. Primaries-only color: 4^9 = 262,144 grids (~65.6k classes), so sample. Full 8-pigment: 8^9 ≈ 134M grids, so sample only. |
| `LensSetSampler` | Picks `k` lenses for a pack slot, honoring palette, multi-color, and diversity constraints. Seeded PRNG. | New-engine counterpart of `buildGeneratorTemplates` / `buildCanonicalTemplatePool` (those stay for legacy callers) |
| `SolutionSpaceEnumerator` | Gray-code subset walk producing the SST (§2) | **This is generation and verification at once.** About 1 ms per lens set. |
| `PuzzleMetrics` | Computes every metric in §4 for a `(lensSet, startState)` from the SST, plus a memoized greedy-player recursion over the reachable states (≤ 2^|P|) | No BFS |
| `TrivialityFilter` | Declarative rules (§4.1) with thresholds from the pack recipe | Each rule returns `{ruleId, passed, detail}` (same shape as `PedagogicalReport`) so rejections can be explained |
| `DifficultyModel` | Feature vector → scalar (§4.3). Weights live in data so they can be calibrated. | Used for new 3×3 packs; `compositeDifficultyScore` is unchanged |
| `CandidateSelector` | From one SST, keeps every start state that passes the filter and lands in the slot's target band, then picks one (seeded) | One lens set usually yields dozens of valid puzzles |
| `PackAssembler` | Builds a 10-slot difficulty ladder. Enforces diversity (no reused lens across adjacent slots, varied move counts and pigments) and dedups with `canonicalPuzzleKey` against all existing packs (read-only) | New-pack counterpart of `assemblePackFromPool` / the slot strategy, with no `PACK_GENERATION_RUNTIME` retry budgets |
| `IndependentVerifier` | Re-checks each chosen puzzle with `findMinMovesBfs` (and/or the WIP algebraic solver): `minMoves` matches, and the witness solution actually clears the grid via `applyTemplate` | Defense in depth. It uses the *production* `applyTemplate`, so a bug in the bit encoding cannot ship. |
| `PackWriter` / CLI `scripts/create-pack.ts` | Emits a `PackDefinition` in the existing format plus a sidecar (`packages/game/src/packMeta/<slug>.json`: recipe, seed, metrics, witness solutions). On `--write`, splices **only the new pack** into `packs.ts` (WIP `packsSourceSplice.ts`); other packs' bytes are never touched | Deterministic given `--seed` |

**Pack recipe (data; the new-pack counterpart of `PackGenerationSpec`):**

```ts
interface Pack3x3Recipe {
  slug: string; name: string; access: 'free' | 'paid';
  seed: number;
  palette: Pigment[];              // e.g. [1] or [1,2,4]
  slots: Array<{                   // length 10
    lensCount: 2 | 3 | 4;
    minMoves: [number, number];    // inclusive band
    difficulty?: [number, number]; // DifficultyModel band (once calibrated)
    requireMultiColorLens?: boolean;
    requireRotation?: boolean;
  }>;
  filter: TrivialityThresholds;    // overrides of the defaults in §4.1
}
```

**Not changed:** daily generation (`generateDailyPuzzle`), runtime hints (`findHintMove`), and the play UI. Puzzles from the new engine are ordinary `PuzzleConfig`s, so the existing BFS hint, solver, and validation code handle them as is. A 3×3 puzzle has at most 2^12 reachable states, so BFS is cheap for these.

---

## 4. Measurable definitions of "trivial" and "fun"

All metrics are exact and come from the SST for one `(lens set L, start state s₀)`. Let `P` = distinct oriented placements and `m = minMoves(s₀)`.

| Metric | Definition | Why it matters to a person |
|---|---|---|
| `minMoves` (m) | min \|S\| | Base length of the plan |
| `minSetCount` | number of subsets of size m that solve | > 1 means several right answers, so it's forgiving and less deduction is needed |
| `nullity` / `totalSetCount` | `|P| − rank`; every reachable state has `2^nullity` solving subsets | **Template flexibility** at the lens-set level: quiet patterns let sloppy play still converge |
| `lensUsage` | distinct lenses in the witness minimal set / `k` | A lens unused by the unique minimal set is a pure decoy |
| `rotationsRequired` | placements in the minimal set with rotation ≠ 0 (only counts when every minimal set needs them) | Rotation is the main remaining decision on 3×3/3×3 |
| `overlapCells` | cells hit by ≥ 2 placements of the minimal set | Coupling: the player can't solve lens by lens just by matching shapes |
| `mixCells` (color) | cells where the minimal set XORs different primaries (for example R then Y to get Orange) | Color decomposition reasoning |
| `dirtyCells` | non-clear cells in s₀ | Visual load. Very low values make the plan obvious. |
| `greedyWinRate` | Probability that a "no-thinking" player wins: from each state, pick uniformly among placements that **strictly reduce dirty cells**; a stuck state counts as a loss. Memoized over ≤ 2^|P| states. | The "solvable without thinking" test. Directly models "templates so flexible you don't need to think". |
| `decisionBits` | `−log₂(minSetCount / C(|P|, m))`: information needed to pick the right subset at random among subsets of the right size | Search-space difficulty independent of ordering, and a cheap stand-in for MUSE on the subset lattice |
| `shapeDistance` | min Hamming distance between lenses over rotations (existing `hasTooSimilarTemplates`) | Near-duplicate lenses confuse without adding depth |

### 4.1 Trivial: reject if any rule fails (defaults; a recipe can relax them for tutorial slots)

| Rule | Default threshold | Rationale |
|---|---|---|
| T1 `minMoves ≥ 2` (≥ 3 after slot 2) | — | 15 of 50 shipped `monochrome` puzzles are one-move |
| T2 `minSetCount == 1` | unique minimal subset | Multiple equal answers means guessing works |
| T3 `greedyWinRate ≤ 0.5` (≤ 0.25 for slots ≥ 4) | — | Thoughtless play must usually fail |
| T4 `lensUsage == 1` | every lens needed | Decoy lenses are an explicit *hard-mode* option, never accidental (18 of 50 shipped `monochrome` puzzles have one) |
| T5 `overlapCells ≥ 2` when `m ≥ 3` | — | Without overlap, each lens is a separate shape-matching exercise |
| T6 `dirtyCells ≥ 5` | of 9 | Sparse boards make the answer visually obvious |
| T7 lens hygiene | ≥ 3 active cells, no containment, `shapeDistance ≥ 2`, no lens with only 1 distinct orientation when `requireRotation` | Reuse `templateContainment.ts` and the `simplePuzzleGeneration.ts` distance check |
| T8 not a duplicate | `canonicalPuzzleKey` unseen across all packs | Existing dedup |

### 4.2 Fun: soft score, used to pick among puzzles that pass

A puzzle is "fun" if it is non-trivial **and** maximizes:

- **One aha:** a unique minimal set (T2) **and** `nullity ≤ 2`, so near-misses don't converge by accident.
- **Uses the toys:** every lens used (T4); `rotationsRequired ≥ 1` from slot 3 on; color packs need `mixCells ≥ 1` and at least one multi-color lens.
- **Coupled but legible:** `overlapCells` in [2, 6], so it isn't independent but also isn't noise.
- **A surprise for greedy play:** `greedyWinRate` in (0, 0.3] for mid-pack. A greedy start feels promising and then fails, which forces a rethink.
- **Variety across the pack:** no lens repeated in adjacent slots, at least 3 distinct `minMoves` values, and pigment variety in color packs.

`funScore = Σ wᵢ · normalized(featureᵢ)` with weights in data. This is the tie-breaker inside a difficulty band, never a filter.

### 4.3 Difficulty that tracks felt difficulty

Initial model (to be calibrated, see §7 S11–S12):

```
difficulty = 1.0·minMoves + 0.8·decisionBits + 0.6·rotationsRequired
           + 0.4·overlapCells + 0.5·mixCells + 3.0·(1 − greedyWinRate)
```

- Every input is exact and order-independent, which avoids the WIP tie-break caveat because the minimal set is unique.
- It drops the signals that measure the generator rather than the puzzle: `scrambleLength`, `rotationReuseCount`, and the `k!`-inflated `shortestSolutionCount`.
- **Calibration:** the DB currently stores only `puzzleProgress.bestMoveCount`. It has no solve time, resets, hints, or abandonment, so felt difficulty can't be measured yet. Step S11 adds that telemetry. Until then, fit the weights to a small internal play-test ranking (pairwise "which was harder?"), and check Spearman correlation the way `report-pack-difficulty.ts --compare` already does.

---

## 5. Baseline and how the design meets 10 puzzles in < 60 s

### 5.1 Command and environment

```bash
# from app-template (repo root)
npx tsx packages/game/scripts/benchmark-pack-generation.ts --runs=3
npx tsx packages/game/scripts/benchmark-pack-generation.ts --only=pool-color-split --runs=4
npx tsx packages/game/scripts/benchmark-pack-generation.ts --only=audit
```

Apple M1 Pro, Node v22.22.0, `main` at the time of the spike. Pool specs scaled to 10 puzzles / 30 candidates, the same 3:1 candidate ratio production uses (50/150).

### 5.2 Today (10 puzzles, 3×3 board)

| Path | Run 1 | Run 2 | Run 3 | Notes |
|---|---|---|---|---|
| `pool-mono` (`monochrome` spec) | 0.27 s | 0.07 s | 0.08 s | Fast, but produces trivial puzzles (§5.4) |
| `pool-color` (`multicolor` spec) | **9.70 s** | **15.90 s** | **60.20 s** | Extremely variable; one run already misses the target |
| `slot-ladder` (`color-ladder` slots) | 2.09 s | 4.77 s | 2.41 s | Retry-driven |
| `simple` (`generateSimplePuzzle` ×10) | 0.019 s | 0.017 s | 0.018 s | 3×3-lens mono, no difficulty scoring |
| `daily` ×10 | 0.45 s | 0.36 s | 0.18 s | |

**Where the color-pool time goes** (`pool-color-split`, 4 runs):

| Candidate pool (30) | Assemble + forgiveness enrichment | Path counts of the selected puzzles |
|---|---|---|
| 1.62 s | 13.87 s | 6,6,2,2,2,24,6,6,6,6 |
| 2.26 s | 32.51 s | 1,6,2,6,2,72,24,12,2,6 |
| 2.21 s | 9.38 s | 1,2,2,2,4,6,6,6,6,6 |
| 2.52 s | 27.27 s | 1,1,2,2,24,24,24,6,24,240 |

`enrichCandidatesWithForgiveness` → `evaluateForgivenessMetrics` → `countSolutionPaths` accounts for **80–93%** of wall time. The counts it pays for are almost all `m!` (2, 6, 24, 120·2), meaning a single minimal set in every order. It is an expensive way to learn "1".

### 5.3 Proposed engine prototype (same script, `prototype`)

10-slot ladder `[2,2,3,3,3,4,4,4,5,5]` with **all T1–T6 filters on**:

| Pack | Run 1 | Run 2 | Run 3 | Worst single puzzle | Lens sets enumerated |
|---|---|---|---|---|---|
| Mono (pigment 1) | 19.0 ms | 6.2 ms | 4.0 ms | 12.1 ms | 41–140 |
| Color (R,Y,B, ≥ 1 multi-color lens) | 13.5 ms | 4.9 ms | 6.2 ms | 4.0 ms | 14–24 |

No slot failed. A typical output row is `4m/g0.00/o6/n2`: 4 moves, greedy players never win, 6 overlap cells, nullity 2.

### 5.4 Triviality audit of shipped 3×3/3×3 puzzles (`audit`)

| Pack | 3×3-lens puzzles | minMoves histogram | minMoves ≤ 1 | Non-unique min set | Unused lens | Greedy win > 50% |
|---|---|---|---|---|---|---|
| `first-steps` | 8 | 2:2 3:4 4:1 6:1 | 0 | 1 | 0 | 2 |
| `monochrome` | 50 | 1:15 2:27 3:8 | **15** | 7 | **18** | 5 |
| `multicolor` | 2 | 2:2 | 0 | 0 | 0 | 0 |

Cross-checked against the existing BFS: `report-pack-difficulty.ts --slug=monochrome` also reports `Moves = 1` for puzzles #1–#15.

**This audit is evidence for the gates in §4.1, not a work item.** None of these puzzles would pass T1/T4, which shows today's creation path has no triviality gate. Existing packs stay as they are; no regeneration or edits are planned.

### 5.5 Budget

| Stage | Per-puzzle budget | Prototype measured | Headroom |
|---|---|---|---|
| Lens-set sampling + SST enumeration (generation **and** exact verification) | 2.0 s | ≤ 12 ms worst, ~1 ms median | > 150× |
| Metrics + filter + selection | 1.0 s | included above | |
| Independent cross-check (BFS `findMinMovesBfs` on the one chosen puzzle; ≤ 2^12 reachable states) | 0.5 s | ~1 ms class (mono BFS here is sub-ms; 3×3-lens color is bounded by 2^|P| states) | |
| Pack assembly, dedup, write | 0.5 s total | negligible | |
| **Total for 10 puzzles** | **≤ 35 s** (25 s reserve inside the 60 s target) | **4–19 ms** | ~3,000× |

The budget is generous so the engine can safely spend it on richer recipes: 4–5 lenses (≤ 1M subsets, estimated tens of ms per set), stricter filters, or generating 10× candidates per slot and choosing the best `funScore`. Add a hard per-slot wall-clock cap (for example 3 s) that fails loudly with the rejection histogram from `TrivialityFilter`, never with a silent retry loop.

---

## 6. Pack-creation workflow (target)

From "I want a pack like X" to a reviewed, committed 10-puzzle pack in under 1 minute of machine time:

```bash
# 1. Draft: derive a recipe from an existing pack's measured profile, or start from a preset
npm run game:create-pack -- --like=monochrome --slug=mono-ladder-2 --name="Mono Ladder II" --seed=42
npm run game:create-pack -- --preset=color-mixing --slug=rgb-mix --seed=7

# 2. Review: the command prints a report (and writes a dry-run JSON for the puzzle lab)
#    slot | minMoves | difficulty | fun | greedy | overlap | lenses | rotations | gates

# 3. Iterate: reroll individual slots deterministically, or tweak the recipe and rerun
npm run game:create-pack -- --recipe=recipes/mono-ladder-2.json --reroll=4,7

# 4. Play-test in /dev/puzzle-lab (loads the dry-run JSON)

# 5. Commit: write the pack and its sidecar, then validate
npm run game:create-pack -- --recipe=recipes/mono-ladder-2.json --write
npm run game:validate
```

| Stage | Behavior | Budget |
|---|---|---|
| Recipe | `--like=<slug>` reads an existing pack **read-only** (palette, lens count, minMoves ladder measured with `PuzzleMetrics`) and writes `recipes/<slug>.json`. `--preset` loads a built-in recipe. The recipe file is the reviewable, diffable source of truth. | < 1 s |
| Generate + verify | Sample lens sets → SST → gates → select → assemble → BFS cross-check (§3) | < 35 s hard cap, ~20 ms typical (§5.5) |
| Review report | Per-slot metrics, pass/fail per gate, rejection histogram per slot, witness solution, difficulty curve across the pack | instant |
| Reroll | `--reroll=<slots>` derives a new sub-seed only for those slots, so the other slots stay byte-identical | < 1 s |
| Write | Splices the new pack into `packs.ts` (no other pack touched), writes the sidecar, and registers the slug in `DEV_PACK_SLUGS` for play-testing. Promotion to `PRODUCTION_PACK_SLUGS` stays a separate manual step. | < 1 s |
| Validate | `game:validate` re-checks packs that have a sidecar with the gates and the verifier. Packs without a sidecar (all existing ones) keep only today's checks. | seconds |

Failures are loud and actionable. If a slot can't be filled within its cap, the command exits non-zero and shows how many candidates each gate rejected (for example "T3 greedy win rate: 412 rejected"), so the designer knows which recipe knob to loosen.

---

## 7. Implementation plan (PR-sized; each step is one Trello card)

Every step adds new code alongside the existing generators. No step changes existing packs, daily generation, or runtime gameplay.

| # | Title | Scope |
|---|---|---|
| S0 | **Spike: creation engine plan + benchmark** | This doc and `scripts/benchmark-pack-generation.ts`. No behavior change. |
| S1 | Add `engine3x3/bitboard` core | `Vec` encoding, rotate, `placementsFor`, `PuzzleConfig`↔`Vec`. Property tests check equivalence with `applyTemplate` / `isSolved` on random inputs. |
| S2 | Add `SolutionSpaceEnumerator` + `IndependentVerifier` | Gray-code SST. The verifier replays witness solutions with production `applyTemplate` and confirms `minMoves` with `findMinMovesBfs`. Tests: SST `minMoves` equals BFS (and the WIP algebraic solver, if merged) on random lens sets and on shipped 3×3-lens puzzles used as read-only fixtures. |
| S3 | Add `PuzzleMetrics` + read-only `report-3x3-metrics` script | All §4 metrics. Works on any pack slug, as a report only. Replaces the benchmark's `audit` mode and is the basis for `--like`. |
| S4 | Add `TrivialityFilter` (rules T1–T8) | Declarative rules with explainable `{ruleId, passed, detail}` results, thresholds as data, per-rule fixture tests. |
| S5 | Add `LensCatalog` + seeded `LensSetSampler` | Mono catalog precomputed (139 classes). Color sampling with palette and multi-color constraints. Seeded PRNG (`mulberry32` or similar) so creation is reproducible. |
| S6 | Add `DifficultyModel` + `funScore` | Initial weights from §4.3, kept as data. Side-by-side report against `compositeDifficulty` for reference. |
| S7 | Add `Pack3x3Recipe` schema + `PackAssembler` | Zod-validated recipe, ladder slots, diversity rules, read-only dedup against all existing packs, per-slot wall-clock cap with a rejection histogram. Tests: a 10-slot recipe assembles in < 60 s (asserted), and the output round-trips through `normalizePuzzleConfig`. |
| S8 | Add `create-pack` CLI (dry run + review report) | `npm run game:create-pack`: recipe in, review report and dry-run JSON out, with `--seed` and `--reroll=<slots>`. Writes nothing to `packs.ts`. |
| S9 | Add `--write`, sidecar, and `--like` / presets | Splice writer (WIP `packsSourceSplice.ts`), `packMeta/<slug>.json` sidecar, `DEV_PACK_SLUGS` registration, `--like=<slug>` recipe derivation, and 3–4 built-in presets (mono intro, mono hard, color mixing, multi-color lens). |
| S10 | Puzzle-lab review + validation gate | `/dev/puzzle-lab` can load a dry-run pack JSON for play-testing (dev-only route, no runtime gameplay change). `game:validate` runs the gates and verifier on sidecar packs only. Acceptance test: the first real pack created end to end. |
| S11 | *(optional)* Play telemetry for calibration | New tables and an API endpoint only: solve time, moves, resets, hints, and abandons per puzzle (aggregate, no PII). Existing tables unchanged. |
| S12 | Calibrate the difficulty model | Fit weights to telemetry (S11) or to internal pairwise play-test rankings, record the Spearman correlation, and freeze the v1 weights in data. Document the workflow in a designer guide (`docs/creating-packs.md`) that links to `docs/difficulty-scoring.md`. |

**Dropped from the earlier draft (now out of scope):** the forgiveness stopgap for the legacy pool, moving daily puzzles to the new engine, regenerating production packs under `-v2` slugs, SST-based runtime hints, and deprecating or deleting legacy generators and packs.

---

## 8. Risks and open questions

### Risks

1. **Gameplay depth on 3×3/3×3.** With no positional choice, solving a puzzle comes down to picking lenses and rotations. The prototype easily produces 5-move puzzles that greedy players can't solve, but there is a hardness ceiling (`minMoves ≤ rank ≤ |P|`, about 6–7 in practice with 3–4 lenses). Mitigation: more lenses (4–5, estimated tens of ms per set), richer palettes, and decoy lenses as an explicit hard-mode rule. Play-test the first created pack (S10) before investing in presets.
2. **The difficulty model is uncalibrated** until telemetry (S11) or play-test data exists. The §4.3 weights are a hypothesis, and `greedyWinRate` models only one kind of naive player.
3. **Two creation paths coexist.** The legacy generators stay because daily puzzles depend on them, so there are two ways to make a puzzle. Mitigation: document `create-pack` as the only supported way to create new packs. Legacy specs in `packGenerationSpecs.ts` stay for reproducibility but get no new entries.
4. **Compatibility.** Anything the engine needs that `PuzzleConfig` can't carry must go in the sidecar. Changing `PuzzleConfig` / `types.ts` would risk breaking stored puzzles and is outside this plan. S7's round-trip test enforces this.
5. **Encoding bugs.** The bit encoding is a second implementation of `applyTemplate`. Running the independent verifier (production `applyTemplate` + BFS) on every emitted puzzle prevents shipping a wrong par.
6. **The color lens space is too big to precompute** (8^9 grids), so color creation depends on good sampling constraints. The gates reject at the puzzle level, so bad samples cost time, never quality.
7. **Validation is asymmetric.** New packs face stricter gates than existing packs, which keep only today's checks. That is intentional because existing content is out of scope, but reviewers should not read a passing `game:validate` as "existing packs are non-trivial". §5.4 shows they are not.
8. **WIP branch divergence.** `wip/generation-in-progress` changes `puzzleSolvability.ts`, `puzzleForgiveness.ts`, and `generationServices.ts`. The new engine doesn't depend on it, and S2's algebraic cross-check is optional.

### Open questions (for the owner)

1. Should every lens be required (strict T4), or are deliberate decoys wanted in late slots?
2. Pigment scope: primaries-only lenses (RYB, more legible), or secondaries on lenses too (larger space, harder)?
3. Lens count per puzzle: fixed at 3, or a 2→4 progression across the pack?
4. Is the optimal-solve badge (`minMovesToSolve`) meant to be exact? The new engine always produces exact pars.
5. Which presets matter most for the first packs (mono ladder, color mixing, multi-color lens)?
6. Where should recipes and sidecars live (`packages/game/recipes/` and `src/packMeta/`?), and should sidecars be committed or regenerated?
7. What telemetry, if any, is acceptable for difficulty calibration (privacy, opt-in)? With none, calibration relies on internal play-tests.
8. Target hardness ceiling: what `minMoves` / difficulty should the last puzzle of a pack have?

---

## Appendix: research notes consulted

- `../flip-math-puzzle-game.md` (outside the repo): GF(2) formulation, layer decoupling, quiet patterns/nullity, MUSE, and an escape-rate ("Richter") hardness scale. `greedyWinRate` here is a cheap, exact, Flip-specific relative of the escape-rate idea (how often an aimless-but-greedy walk reaches the goal).
- `../rotationally-orthoganal.md` (outside the repo): independence under rotation via orbit spans and rank of all rotated, vectorized lenses. In this design that rank is exactly `rank(P)` of the placement matrix, and `nullity = |P| − rank` is reported as the lens-set flexibility metric.
