# Generation Engine Overhaul: 3×3 Puzzles with 3×3 Lenses

> **Status:** planning spike (no production behavior changed).
> **Benchmark script:** `packages/game/scripts/benchmark-pack-generation.ts` (read-only, never writes `packs.ts`).
> **Scope:** `packages/game`. This is a plan for **streamlining how new puzzles and packs are created**. Already-created puzzles (shipped packs, stored daily puzzles) and the daily generator are **out of scope and stay untouched** (see §0).

---

## 0. Scope

**In scope:** a new 3×3-board / 3×3-lens creation engine (generation, exact verification, triviality and fun gates, difficulty scoring) and the designer tooling around it. The goal is to get from "I want a pack like X" to a reviewed, committed pack in under a minute. The benchmark is a 10-puzzle pack; pack size is set per recipe.

**Out of scope (owner decision, revised on PR #22):**
- Migrating, regenerating, re-slugging, freezing, or deleting any existing pack. Player progress (`puzzleProgress`, `savedGameState`) is not touched.
- Changing daily puzzles. `generateDailyPuzzle` and its use of `tryBuildScrambledCandidate` stay as they are.
- Changing runtime gameplay code (hints, `Puzzle.svelte`, the API).
- Removing the legacy generators. They stay in place; the daily generator depends on `packPoolGeneration.ts`. New packs simply stop being created with them.

**Compatibility constraint:** the new engine emits the existing `PuzzleConfig` shape (`startState`, `templates`, `solvedValue`, `minMovesToSolve`) unchanged. Its extra metadata (metrics, witness solution, recipe, seed) goes in a separate sidecar, never into `PuzzleConfig`. Every puzzle already stored in `packs.ts` or the `daily_puzzle` table must keep loading and playing exactly as it does today, through the current `normalizePuzzleConfig` / `parseStoredPuzzle` paths. Nothing gets converted.

### Confirmed constraints (owner answers on PR #22)

1. **Board and lenses:** new puzzles use a 3×3 board, and every lens is 3×3. A lens has exactly one position per rotation, with no translation.
2. **Rotations:** 0/90/180/270° only. No mirroring.
3. **Lens reuse:** lenses can be reused. No game rule forces the player to use every lens; the player wins when the board is clear.
4. **Every lens used:** the *intended* (minimal) solution of every generated puzzle uses every lens at least once. There are no decoy lenses. This is a hard generation filter (T3, §4.1).
5. **Lens count:** 1–3 lenses per puzzle. A 1-lens puzzle that uses its lens is a valid easy opener.
6. **Hard cap:** min moves is never more than 6 (T2, §4.1).
7. **Lens colours:** lenses use primaries (R/Y/B) by default. Secondary (combination) colours on lenses are allowed as an **optional difficulty lever** in the recipe, because they add solve complexity.
8. **Pack size:** packs can be any size. 10 puzzles is the benchmark for creation time and design quality, and nothing in the design hard-codes 10.
9. **No uniqueness requirement:** more than one shortest solution is allowed. Solution count is only an input to the difficulty and fun scores.
10. **Trivial:** a puzzle is trivial if min moves ≤ 1, a greedy player wins > 50% of the time, a lens is unused by the intended solution, there are < 2 overlap cells (for 3+ moves), or there are < 5 coloured cells (§4.1).
11. **No displayed par:** exact min moves is internal only, used for difficulty and the 6-move cap.
12. **Difficulty never uses player data.** It is a purely structural formula, permanently (§4.3).
13. **Output format:** the existing `PuzzleConfig` format, with extra metadata in a sidecar file. Existing packs, daily puzzles, and player progress are untouched.

### Assumptions still unconfirmed

None. The remaining open items are implementation details that do not change the plan (§8).

---

## TL;DR

1. **On a 3×3 board, a 3×3 lens has exactly one legal position per orientation.** A move is just *(lens, rotation)*, so a puzzle with `k ≤ 3` lenses has at most `4k ≤ 12` distinct placements. Moves are XOR: they commute and cancel in pairs. A solution is therefore a **subset** of those placements, not a sequence.
2. That makes the **whole solution space of a lens set enumerable in one pass**: at most 2^12 = 4,096 subsets, using one integer XOR per step on a 27-bit board. That single pass returns exact `minMoves`, the number of minimal solution sets, and one witness solution **for every reachable start state at once**. Generation and verification become the same operation.
3. **Baseline (measured):** a 10-puzzle 3×3 pack takes **0.08–0.27 s (mono pool)**, **2–6 s (color slots)**, and **9.7–60 s (color pool)**, and the color-pool time swings widely from run to run. In the color pool, 80–90% of the time goes to the forgiveness DFS that counts ordered paths (`countSolutionPaths`). That count mostly measures `k!` move orderings, not real alternatives.
4. **Prototype (measured, same script):** with the confirmed constraints (1–3 lenses, ladder 2→6 moves, 6-move cap, every lens used) and all triviality filters on, the subset-enumeration engine built **10-puzzle mono and color packs in 4.8–7.7 ms**, with a worst single puzzle of 2.1 ms. That is roughly **8,000× under** the 60 s target.
5. **Evidence that creation needs quality gates:** 15 of the 50 puzzles in production `monochrome` solve in **one move**, and 18 of 50 have a lens the minimal solution never uses. Today's creation pipeline has no check that catches either. This is cited as evidence only; **no action is planned on existing packs**.
6. Define **trivial** and **fun** with exact, cheap metrics: min moves (2–6), greedy-player win rate, lens usage (every lens used), overlap cells, solution count, decision bits. All of them fall out of the subset enumeration (see §4).
7. **Creation workflow:** a single `game:create-pack` command takes a recipe or `--like=<slug>`, prints a review report, supports deterministic per-slot rerolls, and writes the pack only on `--write`. It completes in seconds (§6), and the implementation plan is S0–S11 (§7).

---

## 1. Today's generation pipeline

### 1.1 Mechanics that matter for design (from the code)

| Fact | Where |
|---|---|
| Cells are 3-bit RYB pigments. A move XORs the lens pigment into each active cell, and the puzzle is solved when every cell is `0`. | `types.ts`, `PuzzleFunctions.ts` → `applyTemplate`, `isSolved` |
| Lenses rotate in 90° steps. Symmetric orientations are deduplicated. | `templatePigment.ts` → `orientTemplate`, `getDistinctTemplateOrientations` |
| Placement is snapped to the nearest in-bounds top-left. On 3×3/3×3 that is always `(0,0)`. | `apps/app/src/lib/utils/templateSnap.ts` → `getSnapToCenterPosition`, `PuzzleFunctions.ts` → `getValidPositions` |
| Lenses can be reused without limit. The win condition is a cleared grid only; "use every lens" is tracked but optional. | `Puzzle.svelte` (`usedTemplateMask`), `PuzzleFunctions.ts` → `isPuzzleComplete` |
| `minMovesToSolve` is optional on `PuzzleConfig` and seeds the hint search depth. Per the owner, no par is shown to players; exact min moves is internal (difficulty, 6-move cap). The new engine still fills this field so hint depth stays correct. | `types.ts`, `Puzzle.svelte` → `handleHint` |
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
| `minimalSolutionCount` (minimal **sets**) vs `shortestSolutionCount` (ordered **paths**) | **Keep** as the solution-count input to difficulty/fun scoring (uniqueness is not required). It confirms the measurement in §5: the path count is inflated by `k!` (observed values 2, 6, 24, 240 = 2!, 3!, 4!, 5!·2). |
| `gf2RowReduce` exported, `PlacementMove` carrying `templateIndex` / `rotation` | Keep; it fits the new core |
| `AlgebraicDifficultyEvaluator` / `AlgebraicMinMovesSolver` with BFS fallback | Would speed up the legacy pool path, but changing legacy generation is out of scope here, so this is not planned. Not needed in the new engine. Its own doc notes the tie-break caveat: metrics computed from the specific chosen solution can differ from BFS when nullity > 0. The new engine avoids that by recording a deterministic **intended solution** (§4) and computing metrics from it. |
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
- Sizes (1–3 lenses, confirmed): 1 lens → ≤ 4 placements → ≤ 16 subsets; 2 lenses → ≤ 256; 3 lenses → ≤ 12 placements → ≤ 4,096 subsets. Since the minimum solution can't use more placements than exist, a 1-lens puzzle has min moves ≤ 4, and the 6-move cap only becomes the binding limit with 2–3 lenses. Every reachable state has exactly `2^nullity` preimages, so nullity can be read off the table: `nullity = |P| − log₂(|table|)`.
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
| `LensCatalog` | Canonical lenses under rotation, filtered by active-cell bounds, palette, and "no containment" (reuse `templateContainment.ts`) | Mono: **139** rotation classes of non-empty 3×3 masks (measured), so the catalog is precomputed and every 1–3-lens set (C(139,3) ≈ 438k triples) can be enumerated offline. Primaries-only color (the default): 4^9 = 262,144 grids (~65.6k classes), so sample. With the optional secondary-colour lever: 8^9 ≈ 134M grids, so sample only. |
| `LensSetSampler` | Picks `k ∈ {1,2,3}` lenses for a pack slot, honoring palette (primaries by default; secondaries only when the recipe enables them), multi-color, and diversity constraints. Seeded PRNG. | New-engine counterpart of `buildGeneratorTemplates` / `buildCanonicalTemplatePool` (those stay for legacy callers) |
| `SolutionSpaceEnumerator` | Gray-code subset walk producing the SST (§2) | **This is generation and verification at once.** About 1 ms per lens set. |
| `PuzzleMetrics` | Computes every metric in §4 for a `(lensSet, startState)` from the SST, plus a memoized greedy-player recursion over the reachable states (≤ 2^|P|) | No BFS |
| `TrivialityFilter` | Declarative rules (§4.1) with thresholds from the pack recipe | Each rule returns `{ruleId, passed, detail}` (same shape as `PedagogicalReport`) so rejections can be explained |
| `DifficultyModel` | Structural feature vector → scalar (§4.3). Weights live in data so designers can tune them. Never uses player data. | Used for new 3×3 packs; `compositeDifficultyScore` is unchanged |
| `CandidateSelector` | From one SST, keeps every start state that passes the filter and lands in the slot's target band, then picks one (seeded) | One lens set usually yields dozens of valid puzzles |
| `PackAssembler` | Builds an N-slot difficulty ladder (N from the recipe; 10 is the benchmark). Enforces diversity (no reused lens across adjacent slots, varied move counts and pigments) and dedups with `canonicalPuzzleKey` against all existing packs (read-only) | New-pack counterpart of `assemblePackFromPool` / the slot strategy, with no `PACK_GENERATION_RUNTIME` retry budgets |
| `IndependentVerifier` | Re-checks each chosen puzzle with `findMinMovesBfs` (and/or the WIP algebraic solver): `minMoves` matches, and the witness solution actually clears the grid via `applyTemplate` | Defense in depth. It uses the *production* `applyTemplate`, so a bug in the bit encoding cannot ship. |
| `PackWriter` / CLI `scripts/create-pack.ts` | Emits a `PackDefinition` in the existing format plus a sidecar (`packages/game/src/packMeta/<slug>.json`: recipe, seed, metrics, witness solutions). On `--write`, splices **only the new pack** into `packs.ts` (WIP `packsSourceSplice.ts`); other packs' bytes are never touched | Deterministic given `--seed` |

**Pack recipe (data; the new-pack counterpart of `PackGenerationSpec`):**

```ts
interface Pack3x3Recipe {
  slug: string; name: string; access: 'free' | 'paid';
  seed: number;
  palette: Pigment[];              // primaries by default, e.g. [1] or [1,2,4]
  allowSecondaryLensPigments?: boolean; // optional difficulty lever: 3/5/6 on lenses
  slots: Array<{                   // any length; 10 is the benchmark
    lensCount: 1 | 2 | 3;
    minMoves: [number, number];    // inclusive band, within [2, 6]
    difficulty?: [number, number]; // DifficultyModel band
    requireMultiColorLens?: boolean;
    requireRotation?: boolean;
  }>;
  filter: TrivialityThresholds;    // overrides of the soft defaults in §4.1 (never T2/T3)
}
```

Default ladder for a 10-puzzle pack (presets can override it):

| Slots | Lenses | Min moves | Levers |
|---|---|---|---|
| 1–2 | 1 | 2 | Openers: one lens, rotation optional |
| 3–4 | 1–2 | 3 | Rotation required |
| 5–6 | 2 | 4 | Overlap ≥ 2 |
| 7–8 | 2–3 | 5 | Overlap, color mixing |
| 9–10 | 3 | 6 (cap) | Optional secondary-colour lenses |

**Not changed:** daily generation (`generateDailyPuzzle`), runtime hints (`findHintMove`), and the play UI. Puzzles from the new engine are ordinary `PuzzleConfig`s, so the existing BFS hint, solver, and validation code handle them as is. A 3×3 puzzle has at most 2^12 reachable states, so BFS is cheap for these.

---

## 4. Measurable definitions of "trivial" and "fun"

All metrics are exact and come from the SST for one `(lens set L, start state s₀)`. Let `P` = distinct oriented placements and `m = minMoves(s₀)`.

**Intended solution:** because uniqueness is not required, a puzzle can have several minimal sets. The engine picks a deterministic *intended solution*: the first minimal set in a fixed order that uses every lens. It is stored in the sidecar, and solution-dependent metrics (`rotationsRequired`, `overlapCells`, `mixCells`) are computed from it. If no minimal set uses every lens, the candidate fails T3.

| Metric | Definition | Why it matters to a person |
|---|---|---|
| `minMoves` (m) | min \|S\| | Base length of the plan |
| `minSetCount` | number of subsets of size m that solve | > 1 means several right answers. That is allowed, but it is more forgiving, so it lowers difficulty through `decisionBits` |
| `nullity` / `totalSetCount` | `|P| − rank`; every reachable state has `2^nullity` solving subsets | **Template flexibility** at the lens-set level: quiet patterns let sloppy play still converge |
| `lensUsage` | distinct lenses in the intended solution / `k` | Must be 1 (owner decision: no decoy lenses) |
| `rotationsRequired` | placements in the intended solution with rotation ≠ 0 | Rotation is the main remaining decision on 3×3/3×3 |
| `overlapCells` | cells hit by ≥ 2 placements of the intended solution | Coupling: the player can't solve lens by lens just by matching shapes |
| `mixCells` (color) | cells where the intended solution XORs different primaries (for example R then Y to get Orange) | Color decomposition reasoning |
| `secondaryLensCells` (color) | active lens cells carrying a secondary pigment (3/5/6), when the recipe enables them | Optional difficulty lever: one placement changes two colour layers at once |
| `dirtyCells` | non-clear cells in s₀ | Visual load. Very low values make the plan obvious. |
| `greedyWinRate` | Probability that a "no-thinking" player wins: from each state, pick uniformly among placements that **strictly reduce dirty cells**; a stuck state counts as a loss. Memoized over ≤ 2^|P| states. | The "solvable without thinking" test. Directly models "templates so flexible you don't need to think". |
| `decisionBits` | `−log₂(minSetCount / C(|P|, m))`: information needed to pick the right subset at random among subsets of the right size | Search-space difficulty independent of ordering, and a cheap stand-in for MUSE on the subset lattice |
| `shapeDistance` | min Hamming distance between lenses over rotations (existing `hasTooSimilarTemplates`) | Near-duplicate lenses confuse without adding depth |

### 4.1 Generation filters: reject if any rule fails

T1–T3 are hard rules set by the owner, and recipes cannot relax them. T4–T6 are the accepted trivial definition; their thresholds can be tuned per slot. T7–T8 are hygiene.

| Rule | Threshold | Rationale |
|---|---|---|
| T1 `minMoves ≥ 2` | hard | Trivial if ≤ 1. 15 of 50 shipped `monochrome` puzzles are one-move. |
| T2 `minMoves ≤ 6` | hard cap | Hardness ceiling (owner decision) |
| T3 intended solution uses every lens (`lensUsage == 1`) | hard | No decoy lenses (owner decision). 18 of 50 shipped `monochrome` puzzles have an unused lens. A 1-lens puzzle passes trivially, so it is a valid easy opener. |
| T4 `greedyWinRate ≤ 0.5` | default; ≤ 0.25 suggested for later slots | Thoughtless play must usually fail |
| T5 `overlapCells ≥ 2` when `m ≥ 3` | default | Without overlap, each lens is a separate shape-matching exercise |
| T6 `dirtyCells ≥ 5` | of 9 | Sparse boards make the answer visually obvious |
| T7 lens hygiene | ≥ 3 active cells, no containment, `shapeDistance ≥ 2`, no lens with only 1 distinct orientation when `requireRotation` | Reuse `templateContainment.ts` and the `simplePuzzleGeneration.ts` distance check |
| T8 not a duplicate | `canonicalPuzzleKey` unseen across all packs | Existing dedup |

There is no uniqueness rule. Multiple minimal solutions are allowed; they only lower `decisionBits`, and with it difficulty.

### 4.2 Fun: soft score, used to pick among puzzles that pass

A puzzle is "fun" if it is non-trivial **and** maximizes:

- **A clear aha:** few minimal sets (low `minSetCount`) and `nullity ≤ 2`, so near-misses don't converge by accident. This is a preference, not a rule.
- **Uses the toys:** every lens used (T3, always); `rotationsRequired ≥ 1` from slot 3 on; color packs need `mixCells ≥ 1` and at least one multi-color lens.
- **Coupled but legible:** `overlapCells` in [2, 6], so it isn't independent but also isn't noise.
- **A surprise for greedy play:** `greedyWinRate` in (0, 0.3] for mid-pack. A greedy start feels promising and then fails, which forces a rethink.
- **Variety across the pack:** no lens repeated in adjacent slots, at least 3 distinct `minMoves` values, and pigment variety in color packs.

`funScore = Σ wᵢ · normalized(featureᵢ)` with weights in data. This is the tie-breaker inside a difficulty band, never a filter.

### 4.3 Difficulty: a structural formula, permanently

Difficulty is computed only from the puzzle's structure. It **never uses player data** (owner decision).

```
difficulty = 1.0·minMoves + 0.8·decisionBits + 0.6·rotationsRequired
           + 0.4·overlapCells + 0.5·mixCells + 0.5·secondaryLensCells
           + 3.0·(1 − greedyWinRate)
```

- Every input is exact and order-independent. Solution-dependent inputs come from the deterministic intended solution, which avoids the WIP tie-break caveat.
- Multiple minimal solutions are allowed and make a puzzle easier through `decisionBits`.
- It drops the signals that measure the generator rather than the puzzle: `scrambleLength`, `rotationReuseCount`, and the `k!`-inflated `shortestSolutionCount`.
- **Tuning:** the weights are data. Designers tune them once by ranking a small set of generated puzzles in pairs ("which was harder?") during internal play-tests, and check Spearman correlation the way `report-pack-difficulty.ts --compare` already does. The formula's inputs remain structural only.

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

Re-run with the confirmed constraints: 10-slot ladder `[2,2,3,3,4,4,5,5,6,6]`, 1 lens for 2-move slots, 1–2 lenses for 3–4 moves, 3 lenses for 5–6 moves, the 6-move cap, every lens used, no uniqueness rule, and T4–T6 on (`npx tsx packages/game/scripts/benchmark-pack-generation.ts --only=prototype`, 3 runs):

| Pack | Run 1 | Run 2 | Run 3 | Worst single puzzle | Lens sets enumerated |
|---|---|---|---|---|---|
| Mono (pigment 1) | 5.6 ms | 5.0 ms | 4.8 ms | 2.1 ms | 19–28 |
| Color (R,Y,B, ≥ 1 multi-color lens) | 7.7 ms | 5.2 ms | 5.7 ms | 2.0 ms | 11–16 |

No slot failed, including the 6-move slots and the 1-lens openers. A typical 6-move row is `6m/g0.00/o7/n1`: 6 moves, greedy players never win, 7 overlap cells, nullity 1.

### 5.4 Triviality audit of shipped 3×3/3×3 puzzles (`audit`)

| Pack | 3×3-lens puzzles | minMoves histogram | minMoves ≤ 1 | Non-unique min set | Unused lens | Greedy win > 50% |
|---|---|---|---|---|---|---|
| `first-steps` | 8 | 2:2 3:4 4:1 6:1 | 0 | 1 | 0 | 2 |
| `monochrome` | 50 | 1:15 2:27 3:8 | **15** | 7 | **18** | 5 |
| `multicolor` | 2 | 2:2 | 0 | 0 | 0 | 0 |

Cross-checked against the existing BFS: `report-pack-difficulty.ts --slug=monochrome` also reports `Moves = 1` for puzzles #1–#15. The "non-unique min set" column is informational only, since uniqueness is no longer a rule.

**This audit is evidence for the gates in §4.1, not a work item.** None of these puzzles would pass T1/T3, which shows today's creation path has no triviality gate. Existing packs stay as they are; no regeneration or edits are planned.

### 5.5 Budget

| Stage | Per-puzzle budget | Prototype measured | Headroom |
|---|---|---|---|
| Lens-set sampling + SST enumeration (generation **and** exact verification) | 2.0 s | ≤ 2.1 ms worst, ~0.3 ms median | > 900× |
| Metrics + filter + selection | 1.0 s | included above | |
| Independent cross-check (BFS `findMinMovesBfs` on the one chosen puzzle; ≤ 2^12 reachable states) | 0.5 s | ~1 ms class (mono BFS here is sub-ms; 3×3-lens color is bounded by 2^|P| states) | |
| Pack assembly, dedup, write | 0.5 s total | negligible | |
| **Total for 10 puzzles** (benchmark size) | **≤ 35 s** (25 s reserve inside the 60 s target) | **4.8–7.7 ms** | ~5,000× |

Time scales linearly with pack size, so larger packs fit easily. The budget is generous so the engine can safely spend it on stricter filters, the secondary-colour lever (bigger lens space to sample), or generating 10× candidates per slot and choosing the best `funScore`. Add a hard per-slot wall-clock cap (for example 3 s) that fails loudly with the rejection histogram from `TrivialityFilter`, never with a silent retry loop.

---

## 6. Pack-creation workflow (target)

From "I want a pack like X" to a reviewed, committed pack (10 puzzles in the benchmark; any size allowed) in under 1 minute of machine time:

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

Failures are loud and actionable. If a slot can't be filled within its cap, the command exits non-zero and shows how many candidates each gate rejected (for example "T4 greedy win rate: 412 rejected"), so the designer knows which recipe knob to loosen. The hard rules T1–T3 are never loosened.

---

## 7. Implementation plan (PR-sized; each step is one Trello card)

Every step adds new code alongside the existing generators. No step changes existing packs, daily generation, or runtime gameplay.

| # | Title | Scope |
|---|---|---|
| S0 | **Spike: creation engine plan + benchmark** | This doc and `scripts/benchmark-pack-generation.ts`. No behavior change. |
| S1 | Add `engine3x3/bitboard` core | `Vec` encoding, rotate, `placementsFor`, `PuzzleConfig`↔`Vec`. Property tests check equivalence with `applyTemplate` / `isSolved` on random inputs. |
| S2 | Add `SolutionSpaceEnumerator` + `IndependentVerifier` | Gray-code SST. The verifier replays witness solutions with production `applyTemplate` and confirms `minMoves` with `findMinMovesBfs`. Tests: SST `minMoves` equals BFS (and the WIP algebraic solver, if merged) on random lens sets and on shipped 3×3-lens puzzles used as read-only fixtures. |
| S3 | Add `PuzzleMetrics` + read-only `report-3x3-metrics` script | All §4 metrics. Works on any pack slug, as a report only. Replaces the benchmark's `audit` mode and is the basis for `--like`. |
| S4 | Add `TrivialityFilter` (rules T1–T8) | Declarative rules with explainable `{ruleId, passed, detail}` results. T1–T3 (min moves 2–6, every lens used) are hard-coded; T4–T8 thresholds are data. Per-rule fixture tests, including a 1-lens opener that passes. |
| S5 | Add `LensCatalog` + seeded `LensSetSampler` | 1–3 lenses. Mono catalog precomputed (139 classes). Color sampling with primaries by default and secondaries behind the recipe flag. Seeded PRNG (`mulberry32` or similar) so creation is reproducible. |
| S6 | Add `DifficultyModel` + `funScore` | Structural formula from §4.3, weights as data, no player data. Side-by-side report against `compositeDifficulty` for reference. |
| S7 | Add `Pack3x3Recipe` schema + `PackAssembler` | Zod-validated recipe (1–3 lenses, minMoves within [2, 6], any slot count), the default ladder, diversity rules, read-only dedup against all existing packs, and a per-slot wall-clock cap with a rejection histogram. Tests: a 10-slot recipe assembles in < 60 s (asserted), and the output round-trips through `normalizePuzzleConfig`. |
| S8 | Add `create-pack` CLI (dry run + review report) | `npm run game:create-pack`: recipe in, review report and dry-run JSON out, with `--seed` and `--reroll=<slots>`. Writes nothing to `packs.ts`. |
| S9 | Add `--write`, sidecar, and `--like` / presets | Splice writer (WIP `packsSourceSplice.ts`), `packMeta/<slug>.json` sidecar, `DEV_PACK_SLUGS` registration, `--like=<slug>` recipe derivation, and 3–4 built-in presets (mono intro, mono hard, color mixing, secondary-colour lenses). |
| S10 | Puzzle-lab review + validation gate | `/dev/puzzle-lab` can load a dry-run pack JSON for play-testing (dev-only route, no runtime gameplay change). `game:validate` runs the gates and verifier on sidecar packs only. Acceptance test: the first real pack created end to end. |
| S11 | Tune difficulty weights + designer guide | Rank generated puzzles in pairs during internal play-tests, tune the §4.3 weights (structural inputs only), record the Spearman correlation, and freeze the v1 weights in data. Write `docs/creating-packs.md`, which links to `docs/difficulty-scoring.md`. |

**Dropped from earlier drafts:** the forgiveness stopgap for the legacy pool, moving daily puzzles to the new engine, regenerating production packs under `-v2` slugs, SST-based runtime hints, and deprecating or deleting legacy generators and packs (all out of scope). The player-telemetry step is also dropped, because difficulty never uses player data.

---

## 8. Risks and open questions

### Risks

1. **Gameplay depth on 3×3/3×3 with 1–3 lenses.** With no positional choice and at most 12 placements, solving a puzzle comes down to picking lenses and rotations. The prototype fills 6-move slots (the cap) that greedy players can't solve, but late-pack variety comes mainly from overlap, rotation, and colour levers. Mitigation: the secondary-colour lever and per-slot `funScore` selection. Play-test the first created pack (S10) before investing in presets.
2. **The difficulty weights are a hypothesis** until the S11 tuning pass. The formula stays structural by design, so it can only approximate felt difficulty. `greedyWinRate` models only one kind of naive player.
3. **Two creation paths coexist.** The legacy generators stay because daily puzzles depend on them, so there are two ways to make a puzzle. Mitigation: document `create-pack` as the only supported way to create new packs. Legacy specs in `packGenerationSpecs.ts` stay for reproducibility but get no new entries.
4. **Compatibility.** Anything the engine needs that `PuzzleConfig` can't carry must go in the sidecar. Changing `PuzzleConfig` / `types.ts` would risk breaking stored puzzles and is outside this plan. S7's round-trip test enforces this.
5. **Encoding bugs.** The bit encoding is a second implementation of `applyTemplate`. Running the independent verifier (production `applyTemplate` + BFS) on every emitted puzzle prevents shipping a wrong internal min-move count (which would break the 6-move cap and hint depth).
6. **The color lens space is too big to precompute** (4^9 grids with primaries, 8^9 with the secondary lever), so color creation depends on good sampling constraints. The gates reject at the puzzle level, so bad samples cost time, never quality.
7. **Validation is asymmetric.** New packs face stricter gates than existing packs, which keep only today's checks. That is intentional because existing content is out of scope, but reviewers should not read a passing `game:validate` as "existing packs are non-trivial". §5.4 shows they are not.
8. **WIP branch divergence.** `wip/generation-in-progress` changes `puzzleSolvability.ts`, `puzzleForgiveness.ts`, and `generationServices.ts`. The new engine doesn't depend on it, and S2's algebraic cross-check is optional.

### Open questions

The owner has answered every design-level question (see "Confirmed constraints" in §0). What remains is implementation detail that doesn't change the plan; the defaults below apply unless someone objects during S7–S9:

1. Presets for the first packs. Default: mono intro, mono hard, color mixing, secondary-colour lenses.
2. Where recipes and sidecars live. Default: `packages/game/recipes/` and `packages/game/src/packMeta/`, both committed.

---

## Appendix: research notes consulted

- `../flip-math-puzzle-game.md` (outside the repo): GF(2) formulation, layer decoupling, quiet patterns/nullity, MUSE, and an escape-rate ("Richter") hardness scale. `greedyWinRate` here is a cheap, exact, Flip-specific relative of the escape-rate idea (how often an aimless-but-greedy walk reaches the goal).
- `../rotationally-orthoganal.md` (outside the repo): independence under rotation via orbit spans and rank of all rotated, vectorized lenses. In this design that rank is exactly `rank(P)` of the placement matrix, and `nullity = |P| − rank` is reported as the lens-set flexibility metric.
