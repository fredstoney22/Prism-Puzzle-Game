# Tutorial & Onboarding Options

Planning spike: how a new player learns Prism's core loop (select a lens, rotate it, apply it, mix colours back to white), what the current tutorial does, and what to build next.

## Decisions

**Owner decisions (PR #23)**
- Build a **new tutorial pack**. Don't rework First Steps, and don't redirect `/tutorial` to it.
- **Link the tutorial pack prominently on the main page.**
- **No automatic routing** of first-time players. A visible link is enough.

**Defaults applied (object if wrong)**
- A code-only audit is acceptable (see Method).
- The tutorial pack follows the new 3×3 rules: 3×3 board, 3×3 lenses, 1–3 lenses per puzzle, every lens used, 2–6 min moves, rotations 0/90/180/270, no par shown. This matches `docs/generation-engine-overhaul.md`.
- Tutorial completion is remembered **in the browser only**, with no server record.
  - Note: `tutorialProgress.ts` today only holds in-memory walkthrough step state. "Browser-only" therefore means a small `localStorage` flag alongside it (see T8).
  - Signed-in players still get per-puzzle progress through the existing `/api/progress`, as for any pack.

**Method.** I audited this from code only. The worktree had no `node_modules` and no `.env`, so I couldn't run `npm run app:dev`. I checked the solvability claims with a standalone BFS over the puzzle configs (all four rotations, every placement), which matches the engine's `solveMinMoves` model. Confirm the bugs in a browser before fixing them.

---

## 1. Audit of the current experience

### 1.1 Pieces

| Piece | File | Role |
|---|---|---|
| `/tutorial` route | `apps/app/src/routes/tutorial/+page.svelte`, `+page.server.ts` | Plays a built-in puzzle (no params) or any pack puzzle (`?pack=&id=`) with a walkthrough card |
| Built-in puzzle | `apps/app/src/lib/constants/tutorialPuzzle.ts` | Plus-shaped red board, one diagonal lens, `minMovesToSolve: 2` |
| Default steps | `apps/app/src/lib/constants/tutorialSteps.ts` (`DEFAULT_TUTORIAL`) | 6 steps: Start, select, place, rotate, solve, finish → `/daily` |
| Walkthrough card | `apps/app/src/lib/components/game/TutorialWalkthrough.svelte` | Text card in the side panel with `n / m` and Start/Next/Skip |
| Step engine | `apps/app/src/lib/utils/tutorialProgress.ts` | Advances `wait` steps on puzzle events (`templateSelect`, `move`, `templateRotate`, `solve`). `info` steps advance on *any* interaction. In-memory only |
| Registry | `apps/app/src/lib/constants/tutorialRegistry.ts` | `pack → puzzleId → TutorialConfig`. Only First Steps is registered |
| Pack wiring | `apps/app/src/routes/(game)/play/game/+page.server.ts`, `(game)/play/puzzles/+page.server.ts` | Walkthrough and concept labels are **hardcoded to `FIRST_STEPS_SLUG`** |
| First Steps copy | `apps/app/src/lib/constants/firstStepsTutorials.ts` | One `info` card each for puzzles 1–7. Fuller scripts for 8 and 9 |
| First Steps puzzles | `packages/game/src/puzzles/firstSteps.ts` and the inline copy in `packages/game/src/packs.ts` | **8** puzzles. `FIRST_STEPS_CONCEPTS` lists 9 |
| How to Play modal | `apps/app/src/lib/components/game/HowToPlay.svelte` | 7-item text list behind `?`. Auto-opens on First Steps #1 (`Puzzle.svelte:121`) |
| Colour guide | `apps/app/src/lib/components/game/ColorVennDiagram.svelte` | RYB Venn diagram button on colour puzzles |
| Hint | `Puzzle.svelte` `handleHint` | Highlights the next placement and auto-rotates the lens. Uses `window.alert` when no hint exists |
| Home page | `apps/app/src/routes/+page.svelte` | Leads with "Play daily puzzle", then "Browse puzzle packs". **No link to any tutorial** |

### 1.2 What First Steps teaches, in order

| # | Concept | Lenses | Colours | Declared / true min moves |
|---|---|---|---|---|
| 1 | Applying a lens | 1 | R | **1 / 3** |
| 2 | Rotating | 1 | R | 3 / 3 |
| 3 | Multiple lenses | 2 | R | 2 / 2 |
| 4 | Reusing a lens | 1 | R | 3 / 3 |
| 5 | Multiple colours (R+Y=O) | 2 | R, Y, O | 2 / 2 |
| 6 | Multi-colour lenses | 3 | R, B, P | 3 / 3 |
| 7 | Colour mixing (Prism) | 3 | 5 colours | 6 / 6 |
| 8 | Multi-colour stencils | 2 | R, Y, O | 4 / 4 |

The concept order is sensible. The problems are in how each concept is delivered, plus the bugs in section 2.

### 1.3 Where a new player is likely to get confused

**Finding the tutorial.** Nothing on the home page points to `/tutorial` or First Steps. The daily puzzle, which is the main call to action, has no guidance at all.

**Controls.**
- **One gesture does two things.** The first tap on a lens selects it and the second tap rotates it (`handleTemplateTap`), with no on-screen cue that the second tap rotates.
- **Three input methods are described inconsistently.** You can tap the lens then the grid, drag it, or tap anywhere on the grid (it snaps to the centre). How to Play says "drag and drop", the default tutorial says "click", and First Steps says "tap".
- **The copy wastes words on placement.** On a 3×3 board with a 3×3 lens there is only one placement, but the copy still says "top-left area". Hover previews don't exist on touch.
- **Hint gets in the way of learning.** It auto-rotates the lens, so it never teaches rotation, and a dead end raises a browser `alert()`.

**Colour mixing.** The XOR rule is a 40-word paragraph (`LENS_TOGGLE`) repeated on four cards. It's the least intuitive rule in the game: red on orange gives yellow, which is the opposite of what a paint model suggests. It's taught by reading, not by seeing.

**The goal.**
- The goal sentence lives in an `info` card that **disappears on the first interaction** (`tryAdvanceOnEvent`).
- On First Steps 1–7 that card is the only step, so all guidance vanishes the moment the player touches anything.
- First Steps #1 also auto-opens How to Play, a 7-bullet wall of text, before the first move.

**Layout.** On mobile (`PuzzlePlayLayout.svelte`, under 640px), the guidance panel stacks above the board, capped at 40vh. Nothing points at the lens or the board.

**Par and stars.** The win card's star rating uses `minMovesToSolve`. That conflicts with the no-par direction and, combined with bug B2, penalises beginners.

---

## 2. Bugs found (fix independently of the new pack)

These are clear bugs. Each one gets a small PR with no dependencies (T1–T3 in the plan).

| ID | Bug | Evidence | Fix |
|---|---|---|---|
| B1 | **The built-in `/tutorial` puzzle can't be solved.** | The board is a plus shape. The diagonal 3×3 lens has one placement and two distinct orientations, and combinations of them only produce the diagonal, the anti-diagonal or the four corners. A player who follows the steps gets stuck on step 5. The e2e tests (`apps/app/tests/puzzle-interactions.test.ts`) only check that the board changes. `/tutorial` is in `sitemap.xml`. | Replace `TUTORIAL_PUZZLE_CONFIG` with a solvable 2-move puzzle (one lens, two different rotations) that matches the existing step copy. Fix "top-left area" in the copy. Add an e2e or unit test that actually solves it. |
| B2 | **First Steps #1 declares 1 move but needs 3.** | 3 red cells and a 1-cell lens, so the player must rotate between applications. The star rating marks perfect solves as not optimal, and the puzzle teaches rotation before #2. | Set `minMovesToSolve: 3` in both `firstSteps.ts` and `packs.ts` (via `sync-first-steps-packs.ts`). Add a unit test that every First Steps puzzle's declared moves equal `solveMinMoves`. |
| B3 | **The First Steps "puzzle 9" doesn't exist.** | `FIRST_STEPS_TUTORIALS[9]` and `FIRST_STEPS_CONCEPTS[9]` exist, but the pack has 8 puzzles. Puzzle 8's "Next puzzle" links to `id=9`. `PACK_DESCRIPTIONS` says "9 puzzles". | Remove the puzzle 9 entries, treat 8 as the last puzzle in `finishStep`, and change the description to 8 puzzles. |

There are also small copy nits: `GOAL` is an empty string, so card bodies start with a stray space; "where its applied" is missing an apostrophe; and the default tutorial says "Flip" and "template" where First Steps says "Prism" and "lens". These can ride along with B1 and B3.

### What happens to the existing `/tutorial` and First Steps

- **`/tutorial`:** Keep the route and fix B1 only. Once the tutorial pack ships, consider pointing the no-params `/tutorial` at tutorial pack puzzle 1 (optional T11). That isn't the First Steps redirect the owner rejected; it just stops two separate beginner experiences from drifting apart.
- **First Steps:** Keep it as a free practice pack and fix B2 and B3 only. Move its "Start here!" tagline (`PACK_SHORT_DESCRIPTIONS`) to the tutorial pack so there's one obvious starting point. Leave its walkthrough copy alone.

---

## 3. Best practices for puzzle-game onboarding

- **Teach by doing.** Get the player to a playable board and a first success within seconds. *Monument Valley* and *Threes!* open with play, not text.
- **One concept per puzzle, and make it the only way through.** *The Witness* and *Baba Is You* teach almost entirely through level design. *Snakebird* and *Stephen's Sausage Roll* use tiny boards so what the player sees is the lesson.
- **Progressive disclosure.** Hold back Undo, Reset, Hint, stars and colour theory until they're needed (*Two Dots*, *Flow Free*).
- **Show cause and effect.** Animate or preview the transformation for non-obvious rules (here, XOR mixing). *Hue* and *Mini Metro* use short visual beats instead of text.
- **Contextual, escalating hints.** Help should appear on the element involved (a pulse on the lens, a ghost hand) and only when the player stalls: nudge, then highlight, then show the answer. *Candy Crush* points a hand at the first swaps.
- **Make it safe to experiment.** Cheap undo, and no score or par during the tutorial.
- **Skippable, replayable, easy to find.** Never trap the player, and make it easy to come back.
- **Mobile touch affordances.** Don't rely on hover; targets at least 44 pt; one gesture means one thing; guidance close to where the thumb works.
- **Measure it.** Track the funnel (started, solved #N, finished) to find where players drop off.

---

## 4. Approaches (updated with the owner's answers)

| | Approach | How it works for Prism | Pros | Cons / risks | Effort | Status |
|---|---|---|---|---|---|---|
| A | Polish the guided walkthrough | Keep `TutorialWalkthrough`. Cards persist until the action is done, one sentence each, consistent terms | Small; reuses tested code | Still text-first and away from the board | S | **Partly adopted**: one-line titles on the new pack only. First Steps copy stays as-is |
| B | Tutorial by level design | A new pack of tiny 3×3 puzzles, each solvable **only** with its concept, almost no text | Strongest evidence from comparable games; works on any device and language; fits the 3×3 rules | Careful authoring; doesn't explain controls by itself | M | **Adopted**: this is the new tutorial pack |
| C | In-place, idle-triggered hints | Ghost hand or pulse on the lens; a rotate arrow after a select with no rotation; escalate to the existing Hint. Driven by `tutorialProgress.ts` events plus a timer | Help appears where the eye and thumb are; invisible to players who don't need it | Overlay positioning and threshold tuning; must respect reduced motion | M | **Recommended**, scoped to the tutorial pack |
| D | Colour sandbox | A no-goal playground for trying lenses on cells | Builds colour-mixing intuition | Few players will open it; a parallel UI that can drift | M | Deferred |
| E | Short animated demo | A 5–8 s loop: ghost hand selects, rotates, applies, board turns white | Shows the goal at a glance; good for marketing | Watching teaches less than doing | S–M | Optional, on the home-page link card |

The owner's answers removed the alternatives of reworking First Steps or redirecting `/tutorial`, and settled discovery: a main-page link, with no auto-routing.

---

## 5. Recommendation

**Build a new free tutorial pack, designed so each puzzle teaches one concept through play (B). Add in-place hints when a player stalls (C) and a prominent "Learn to play" link on the home page. Fix bugs B1–B3 separately.**

### 5.1 The tutorial pack

- **Name and slug:** a working name such as *Learn to Play* (`learn-to-play`). It's free and listed first in `/play`, with the "Start here!" tagline.
- **Rules:** 3×3 board, 3×3 lenses, 1–3 lenses per puzzle, every lens used, 2–6 min moves, 0/90/180/270 rotations, no par or stars shown.
- **Proposed ladder:** about 8 puzzles. Each puzzle's concept must be *required*: test that the puzzle is unsolvable, or needs more moves, without it.

| # | Concept | Design constraint |
|---|---|---|
| 1 | Apply lenses | 2 lenses, each applied once at the default rotation. Single colour, 2 moves |
| 2 | Rotate | 1 lens, needs two different rotations, 2 moves |
| 3 | Reuse a lens | 1 lens applied 3 times at different rotations |
| 4 | Combine lenses | 2 lenses, at least one rotated, with overlapping cells (a cell flipped twice returns to white) |
| 5 | Lenses remove colour | A red lens on an orange board leaves yellow, so the player sees XOR removal |
| 6 | Multi-colour lens | One lens carrying two colours |
| 7 | Mixing to Prism | All three primaries meeting on a cell |
| 8 | Put it together | 3 lenses, at most 6 moves |

The 2-move minimum rules out a one-tap opener. Puzzle 1 uses two lenses at the default rotation instead, so applying lenses and using every lens are taught before rotation.

- **Text:** one short title per puzzle ("Rotate the lens") as a persistent `wait`-style card. No paragraphs, and How to Play does not auto-open.
- **Authoring:** hand-author and validate with the existing `solveMinMoves`. That avoids depending on the engine overhaul. If S8 (`create-pack`) lands first, it can generate candidates instead.

### 5.2 Hints (C)

Scope the hint layer to the tutorial pack:
- An idle nudge on the lens after about 5 s with no selection.
- A rotate cue when a puzzle needs rotation and the player has applied without rotating.
- After N moves past the minimum, a highlight via the existing Hint, with an inline message instead of `alert()`.

### 5.3 Main-page link

Add a "New to Prism? Learn to play" card at the **top** of the home page, above the daily puzzle, linking to tutorial pack puzzle 1. After completion (browser flag), the card shrinks to a small "Replay tutorial" link rather than disappearing. There is no auto-redirect.

### Why this combination

The two hardest things in Prism are the double-tap-to-rotate control and XOR colour mixing, and text explains neither well. Puzzles that require the concept teach it best (B). Anchored hints catch the players B alone would lose (C). The home-page link fixes discovery without forcing anyone through it. The plan meets the 3×3 rules, leaves First Steps intact, and keeps each step independently shippable.

---

## 6. Implementation plan

Each row is one PR. T1–T3 are bug fixes with no dependencies.

| Step | Title | Scope | Depends on |
|---|---|---|---|
| T1 | Fix unsolvable built-in /tutorial puzzle | Replace `TUTORIAL_PUZZLE_CONFIG` (`apps/app/src/lib/constants/tutorialPuzzle.ts`) with a solvable 2-move 3×3 puzzle (one 3×3 lens, two different rotations). Update `DEFAULT_TUTORIAL` copy to drop "top-left area" and use "lens"/"Prism". Add a test that solves it end to end (Playwright on `/tutorial`) and a unit check that `solveMinMoves` equals the declared moves. | – |
| T2 | Fix First Steps #1 declared min moves | Set puzzle 1's `minMovesToSolve` to 3 in `packages/game/src/puzzles/firstSteps.ts` and the inline block in `packages/game/src/packs.ts` (via `sync-first-steps-packs.ts`). Add a unit test asserting every First Steps puzzle's declared moves equal `solveMinMoves`. | – |
| T3 | Remove phantom First Steps puzzle 9 | Delete puzzle 9 from `FIRST_STEPS_TUTORIALS` and `FIRST_STEPS_CONCEPTS`, make `finishStep` treat puzzle 8 as last (link back to the pack), change `PACK_DESCRIPTIONS['first-steps']` to "8 puzzles", and fix the empty `GOAL` prefix and "its" typo in `firstStepsTutorials.ts`. | – |
| T4 | Make pack walkthroughs registry-driven | Replace the `FIRST_STEPS_SLUG` hardcoding in `(game)/play/game/+page.server.ts` and `(game)/play/puzzles/+page.server.ts` with lookups in `tutorialRegistry.ts`, plus a concept map keyed by pack, so any registered pack gets a walkthrough and concept labels. No behaviour change for First Steps. Unit tests for the registry. | – |
| T5 | Author tutorial pack puzzles | Add `packages/game/src/puzzles/learnToPlay.ts` (about 8 puzzles per the ladder in section 5.1: 3×3 board and lenses, 1–3 lenses, every lens used, 2–6 min moves) with a concept map, plus the inline `packs.ts` entry. Vitest checks per puzzle: declared moves equal `solveMinMoves`, minimum within 2–6, every lens used in the optimal solution, and the concept is required (e.g. puzzle 2 unsolvable without rotation). Not yet in production packs. | – |
| T6 | Ship tutorial pack with one-line walkthrough | Register the pack in `PRODUCTION_PACK_SLUGS` as free, list it first in `/play`, move the "Start here!" tagline from First Steps, add a `PACK_DESCRIPTIONS` entry, and register one persistent one-sentence card per puzzle in `tutorialRegistry.ts`. Don't auto-open How to Play. Hide par and star rating on this pack. Playwright smoke: open puzzle 1 and see the card. | T4, T5 |
| T7 | Add "Learn to play" link to home page | Prominent card at the top of `apps/app/src/routes/+page.svelte`, above the daily card, linking to tutorial pack puzzle 1. No auto-routing. Update `apps/app/tests/smoke.test.ts`. | T6 |
| T8 | Remember tutorial completion in browser | On solving the last tutorial pack puzzle, set a `localStorage` flag (try/catch, next to `tutorialProgress.ts`). The home card shows a compact "Replay tutorial" link when the flag is set. No server record. Unit test for the flag helper. | T7 |
| T9 | In-place hint layer for tutorial pack | Coach marks anchored to the lens and board: an idle nudge, a rotate cue when rotation is required but unused, escalation to the existing Hint, and an inline message replacing the Hint `window.alert`. Driven by `tutorialProgress` events plus a timer. Respects `prefers-reduced-motion`. Enabled only for the tutorial pack. | T6 |
| T10 | Onboarding funnel events (optional) | Emit events for tutorial puzzle start and solve, hints shown or used, and skip, so T6/T9 can be measured. No PII. | T6 |
| T11 | Point /tutorial at the tutorial pack (optional) | Make no-params `/tutorial` load tutorial pack puzzle 1 instead of the built-in puzzle. Keep `?pack=&id=` behaviour. Update e2e tests. | T6 |
| T12 | Animated demo on home link card (optional) | A 5–8 s scripted loop (select, rotate, apply, board turns white) inside the T7 card. Tap to start the tutorial. Paused under reduced motion. | T7 |
