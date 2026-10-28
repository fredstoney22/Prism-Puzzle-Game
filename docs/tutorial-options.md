# Tutorial & Onboarding Options

Planning spike: how a new player learns Prism's core loop (select a lens, rotate it, apply it, mix colours back to white), what the current tutorial does, and which approach to take next.

**Method.** I audited this from code only. The worktree has no `node_modules` and no `.env`, so I didn't run `npm run app:dev`. I checked the solvability claims below with a standalone BFS over the puzzle configs (all four rotations, every placement), which is the same model the engine's `solveMinMoves` uses. Before acting on the bugs in section 1.3, confirm them in a browser.

**Direction this has to fit.** Puzzle generation is moving to 3×3 boards with 3×3 lenses, 1–3 lenses per puzzle, every lens used, at most 6 moves, rotations of 0/90/180/270 only, and no par shown to players. Every recommendation below assumes that format.

---

## 1. Audit of the current experience

### 1.1 Pieces

| Piece | File | Role |
|---|---|---|
| `/tutorial` route | `apps/app/src/routes/tutorial/+page.svelte`, `+page.server.ts` | Plays a built-in puzzle (no pack params) or any pack puzzle (`?pack=&id=`) with a walkthrough beside it |
| Built-in puzzle | `apps/app/src/lib/constants/tutorialPuzzle.ts` | Plus-shaped red board, one diagonal lens, `minMovesToSolve: 2` |
| Default steps | `apps/app/src/lib/constants/tutorialSteps.ts` (`DEFAULT_TUTORIAL`) | 6 steps: Start, select, place, rotate, place/solve, finish → `/daily` |
| Walkthrough card | `apps/app/src/lib/components/game/TutorialWalkthrough.svelte` | Text card in the side panel. Shows `n / m` and Start/Next/Skip |
| Step engine | `apps/app/src/lib/utils/tutorialProgress.ts` | Advances `wait` steps on puzzle events (`templateSelect`, `move`, `templateRotate`, `solve`). `info` steps advance on *any* interaction |
| Registry | `apps/app/src/lib/constants/tutorialRegistry.ts` | Maps `pack → puzzleId → TutorialConfig`. Only First Steps is registered |
| First Steps copy | `apps/app/src/lib/constants/firstStepsTutorials.ts` | One `info` card per puzzle for puzzles 1–7. Fuller scripts for 8 and 9 |
| First Steps puzzles | `packages/game/src/puzzles/firstSteps.ts` and the inline copy in `packages/game/src/packs.ts` | **8** puzzles. `FIRST_STEPS_CONCEPTS` lists 9 |
| In-game walkthrough | `apps/app/src/routes/(game)/play/game/+page.svelte` | Same card, shown only for `first-steps` |
| How to Play modal | `apps/app/src/lib/components/game/HowToPlay.svelte` | 7-item text list behind `?`. Opens automatically on First Steps #1 (`Puzzle.svelte:121`) |
| Colour guide | `apps/app/src/lib/components/game/ColorVennDiagram.svelte` | RYB Venn diagram button on colour puzzles |
| Hint | `Puzzle.svelte` `handleHint` | Highlights the next placement and auto-rotates the lens. Uses `window.alert` when no hint exists |

### 1.2 What is taught, in what order

First Steps teaches one concept per puzzle. The table shows the declared move count next to the true minimum I computed.

| # | Concept | Lenses | Colours on board | Declared / true min moves |
|---|---|---|---|---|
| 1 | Applying a lens | 1 | R | **1 / 3** |
| 2 | Rotating | 1 | R | 3 / 3 |
| 3 | Multiple lenses | 2 | R | 2 / 2 |
| 4 | Reusing a lens | 1 | R | 3 / 3 |
| 5 | Multiple colours (R+Y=O) | 2 | R, Y, O | 2 / 2 |
| 6 | Multi-colour lenses | 3 | R, B, P | 3 / 3 |
| 7 | Colour mixing (Prism = all three) | 3 | 5 colours | 6 / 6 |
| 8 | Multi-colour stencils | 2 | R, Y, O | 4 / 4 |

The order is sensible: placement, then rotation, multiple lenses, reuse, colour, mixing, stencils. It also matches the 3×3 direction already. The problems are in how each step is delivered and in a few outright bugs.

### 1.3 Bugs found (high confidence; confirm in a browser)

1. **The built-in `/tutorial` puzzle can't be solved.** The board is a plus shape. The only lens is a 3×3 diagonal, so on a 3×3 board it has exactly one placement and two distinct orientations. Combining them only ever produces the diagonal, the anti-diagonal or the four corners, never the plus. The copy ("click the top-left area… where the template fits") dates from an older, larger board. A player who follows the steps exactly gets stuck on step 5. The e2e tests (`apps/app/tests/puzzle-interactions.test.ts`) only check that the board *changes*, so this got through. `/tutorial` is also listed in `sitemap.xml`, which makes it a likely landing page.
2. **First Steps #1 declares 1 move but needs 3.** The board has 3 red cells and the lens has a single cell, so the player must rotate between applications. The star rating compares against `minMovesToSolve`, so even a perfect first solve shows as "not optimal". The puzzle also teaches rotation before #2, the puzzle meant to introduce it.
3. **There is no puzzle 9.** `FIRST_STEPS_TUTORIALS[9]` and `FIRST_STEPS_CONCEPTS[9]` exist, but the pack has 8 puzzles. The finish step on #8 still links to `id=9` (`finishStep` treats only `>= 9` as the last puzzle), so "Next puzzle" goes to a missing puzzle.
4. **Copy problems.** `GOAL` is an empty string, so every card body starts with a stray space. "where its applied" is missing an apostrophe. The default tutorial says "Welcome to Flip" and "template", while First Steps says "Prism" and "lens".

### 1.4 Where a new player is likely to get confused

**Finding the tutorial.** The home page (`apps/app/src/routes/+page.svelte`) leads with "Play daily puzzle", and the daily puzzle has no walkthrough. Nothing links to `/tutorial`, and First Steps only appears inside "Browse puzzle packs". Nothing detects a first visit or remembers that the tutorial was finished: walkthrough state lives only in component memory.

**Controls.**
- **One gesture does two things.** The first tap on a lens selects it and the second tap rotates it (`handleTemplateTap`). Nothing on screen says the second tap will rotate, and a player who taps twice "to make sure" rotates by accident.
- **Three input methods are described in three different ways.** You can tap a lens then tap the grid, drag the lens onto the grid, or tap anywhere on the grid (it snaps to the centre). How to Play says "drag and drop", the default tutorial says "click", and First Steps says "tap".
- **Hover previews don't exist on touch.** On a 3×3 board there is only one placement, so "where to place" is no real decision. The tutorial copy still spends words on it ("top-left area").
- **Hint behaves inconsistently.** It auto-rotates the lens, which teaches nothing about rotation, and a dead end raises a browser `alert()`.

**Colour mixing.**
- The XOR rule is taught as one 40-word paragraph (`LENS_TOGGLE`), repeated on four cards. It's the hardest idea in the game, and it's taught by reading rather than by seeing. A lens adds a colour where it is missing and removes it where it is present. On a single-colour board that just looks like a toggle. With colours, applying red to orange gives yellow, which surprises most players (on a paint model they'd expect adding red to make orange redder).
- The Venn diagram helps, but it's a separate button the player has to find.

**The goal.**
- "Clear all the color from the Prism Square" appears once, in an `info` card that **disappears on the first interaction** (`tryAdvanceOnEvent` skips `info` on any event). On puzzles 1–7 the card is the *only* step, so the guidance vanishes the moment the player touches anything.
- First Steps #1 also auto-opens the How to Play modal on top of the board: a wall of 7 bullets, including Undo, Reset and Hint, before the player has made a single move.

**Layout.** On mobile (`PuzzlePlayLayout.svelte`, under 640px), the side panel stacks above the board and is capped at 40vh. Text guidance sits away from the thing it describes; there's no pointer, highlight or arrow on the lens or the board.

**Par and stars.** The win card's star rating compares moves against `minMovesToSolve`. That conflicts with the "no par shown" direction, and with bug 2 it penalises new players.

---

## 2. Best practices for puzzle-game onboarding

- **Teach by doing, not reading.** Players skip text. The first screen should be something they can interact with, and the first success should come within seconds. *Monument Valley* and *Threes!* open with a playable board and almost no words.
- **One concept per step, and make the concept the only way through.** Design each early puzzle so the new idea is *required* and nothing else is in the way. *The Witness* and *Baba Is You* teach almost entirely through level design: the first panel or level can only be solved by understanding the rule. *Snakebird* and *Stephen's Sausage Roll* use tiny boards so that what the player sees is the lesson.
- **Progressive disclosure.** Hold back Undo, Reset, Hint, stars and colour theory until they're needed. *Two Dots* and *Flow Free* show the minimum UI first.
- **Show cause and effect.** When a rule is non-obvious (here, XOR colour mixing), *show* the transformation: animate the lens passing over a cell and the colour changing, or show a live preview before committing. *Mini Metro* and *Hue* use short animated beats instead of text.
- **Contextual, just-in-time hints.** Help should appear where and when it's needed, attached to the element involved (a pulse on the lens, a ghost hand), and should escalate only if the player is stuck: nudge, then highlight, then show the answer. *Candy Crush* points a hand at the first swaps. *Duolingo* gives feedback at the moment of the mistake.
- **Make it safe to experiment.** Cheap undo and no penalty for failing in the tutorial. The penalty for a "wrong" move should only be wasted time.
- **Skippable, re-findable and remembered.** Experienced players can skip; anyone can replay; the game remembers completion so returning players don't see it again. Never trap the player.
- **Mobile touch affordances.** No reliance on hover. Targets at least 44 pt. One gesture means one thing. Animated hands or ghosts to show drag versus tap. Guidance placed next to the thumb's working area, not in a panel above the fold.
- **Measure it.** Track the funnel (started, step N, solved #1, finished the pack) so you can see where players drop off.

---

## 3. Approaches

Fixing the bugs in 1.3 is a prerequisite for every option below.

### A. Polish the current guided walkthrough
**How it works.** Keep `TutorialWalkthrough` and the step engine. Make `info` cards persist until the player completes the relevant action, instead of vanishing on the first touch. Turn the puzzle 1–7 cards into short `wait` scripts (select, rotate, apply). Cut every card to one sentence, use "lens" and "Prism" everywhere, drop the auto-opening How to Play modal, and make `/tutorial` simply redirect to First Steps #1. On mobile, show the card as a compact banner directly above the lens tray rather than at the top of the screen.
- **Pros:** Smallest change; reuses tested infrastructure (`tutorialProgress.test.ts`). The copy is easy to iterate.
- **Cons:** Still text-first, and the guidance still sits away from the element it describes. The colour rule is still explained in words.
- **Effort:** S.
- **Risks:** Low. Text-heavy tutorials are the most-skipped kind, so the ceiling is limited.

### B. Tutorial by level design (almost no text)
**How it works.** Rebuild First Steps as about 8–10 tiny 3×3 puzzles, each solvable *only* by using the new concept. For example:
1. One lens, one placement, no rotation needed: apply it once and the board turns white.
2. The same lens, but the board needs a 90° rotation.
3. Needs the lens twice at different rotations.
4. Two lenses, both required.
5. One colour on top of another (R on O leaves Y), so the player sees removal.
6. A multi-colour lens.
7. Mixing to Prism.
8. A synthesis puzzle within the 6-move cap.

Text shrinks to a title per puzzle ("Rotate"). Generate and validate candidates with the existing pedagogy tools in `packages/game` (`FIRST_STEPS_CONCEPTS`, `pedagogyConceptId`, `solveMinMoves`). Add a test asserting each puzzle's true minimum equals its declared moves and that the new concept is required.
- **Pros:** Strongest evidence from comparable games (*Witness*, *Baba*, *Snakebird*). Works on any device and in any language. Fits the 3×3, ≤6-move, every-lens-used direction exactly. It also fixes bug 2 as a by-product.
- **Cons:** Needs careful puzzle authoring. On its own it doesn't explain *controls* (that tapping twice rotates).
- **Effort:** M (authoring plus validation tests, and keeping `packs.ts` in sync with `sync-first-steps-packs.ts`).
- **Risks:** A player who never discovers rotation is stuck on #2 with no help. This needs a fallback (C).

### C. Contextual just-in-time hints (in-place coach marks)
**How it works.** A small hint layer anchored to real elements: a pulsing ring or ghost hand on the lens ("tap"), a curved arrow showing a second tap rotates it, and a ghost drag onto the Prism. Hints fire on **idle triggers**: no selection after about 5 s, the same wrong move repeated, no rotation after N moves when rotation is required. They escalate from nudge to highlight to existing Hint. Hint copy goes inline instead of in the side panel. The layer is driven by the same puzzle events `tutorialProgress.ts` already emits, plus a timer. It only runs on First Steps and on a player's first few daily puzzles, and it remembers which hints have been shown, in `localStorage` with a per-user server copy later.
- **Pros:** Guidance appears exactly where the eye and thumb are, which is the best fit for mobile. Players who already know the game see nothing. The same layer can introduce new mechanics in later packs.
- **Cons:** Overlay positioning across breakpoints and during the rotate and win animations. Idle thresholds need tuning.
- **Effort:** M.
- **Risks:** Badly tuned hints feel patronising or fire mid-thought. Needs an off switch and respect for reduced-motion settings.

### D. Interactive sandbox / colour lab
**How it works.** A no-goal playground: the board plus a palette of single-colour and multi-colour lenses. Tapping a cell or applying a lens shows the XOR result live, alongside the Venn diagram. It's reachable from the colour-guide button and from First Steps #5.
- **Pros:** Lets players build an intuition for colour mixing by experimenting, and it's good for curious players.
- **Cons:** There's no goal, so many players won't open it. It teaches the colour rules but not the game.
- **Effort:** M.
- **Risks:** Builds a parallel UI that drifts from the real puzzle. Low reach.

### E. Short animated demo (attract loop)
**How it works.** A 5–8 second looping animation before the first puzzle, or on the home card in place of the static preview (`PuzzleGridPreview`). A ghost hand selects a lens, rotates it, drags it onto the Prism, and the colours flip to white. It's tappable to skip and replayable from `?`. You can build it from existing components by scripting `Puzzle` state, without video.
- **Pros:** Shows the whole loop *and the goal* at a glance, with no reading. Also works as marketing on the home page.
- **Cons:** Watching is weaker than doing. Players forget the details.
- **Effort:** S–M.
- **Risks:** Treated as a loading screen and ignored. Must never block input.

### Comparison

| | Teaches controls | Teaches colour rule | Teaches goal | Mobile fit | Effort |
|---|---|---|---|---|---|
| A. Polished walkthrough | ok | weak (text) | ok | ok | S |
| B. Level design | weak alone | strong | strong | strong | M |
| C. Contextual hints | strong | ok | ok | strong | M |
| D. Sandbox | – | strong (opt-in) | – | ok | M |
| E. Animated demo | ok | weak | strong | strong | S–M |

---

## 4. Recommendation

**Combine B and C, using A's cheap fixes now, and E only as an optional extra.**

- **Now (S):** Fix the bugs in 1.3 and do the A-level copy and layout fixes: persistent cards, one sentence each, consistent terms, no auto-opening modal. Point `/tutorial` and the home page's first-visit flow at First Steps #1.
- **Core (M):** Rebuild First Steps with **level design** (B) so each puzzle forces exactly one concept on a 3×3 board within the new constraints. Add **contextual idle-triggered hints** (C) so a player who doesn't discover rotate, drag or multi-colour gets a nudge on the element itself rather than a paragraph.
- **Then retire most of the walkthrough text.** Keep the step engine (C's triggers reuse it), but reduce per-puzzle copy to a title. How to Play stays as a reference behind `?`.
- **Defer D and E.** E is a good home-page improvement once the loop is solid. D is a nice-to-have for colour-curious players.

**Why.** The two hardest things in Prism are the double-tap-to-rotate control and XOR colour mixing. Text explains neither well. Puzzles that *require* the concept teach it best (B). Anchored, escalating hints catch the players B alone would lose (C). Both fit the 3×3, ≤6-move, every-lens-used, no-par direction. Finally, B and C are the only options whose effect you can measure per puzzle: did the player solve #2 without a hint?

---

## 5. Follow-up cards (each one PR)

1. **Fix the built-in `/tutorial` puzzle or redirect it.** Replace the unsolvable plus board, or redirect `/tutorial` to First Steps #1. Add an e2e test that actually *solves* the tutorial. (S)
2. **Fix First Steps data bugs.** Correct #1's `minMovesToSolve` (or redesign it as a true one-move puzzle), and remove the stale puzzle 9 config, concept and `id=9` link. Add a unit test that the declared moves equal `solveMinMoves` for every First Steps puzzle. (S)
3. **Walkthrough copy and behaviour pass.** Keep `info` cards until the relevant action, one sentence per card, "lens"/"Prism" everywhere, remove the empty `GOAL` and the auto-opening How to Play modal, and place the card next to the lens tray on mobile. (S)
4. **First-visit routing and completion memory.** Detect first-time players (local flag plus a per-user record when signed in), route them to First Steps from the home page and the daily page, and add a visible "How to play" entry on the home page. (S–M)
5. **Hide par and stars during onboarding.** Remove the star rating from First Steps now, in line with the no-par direction. (S)
6. **Redesign First Steps by level design.** About 8–10 3×3 puzzles, one required concept each, ≤6 moves, every lens used. Validate with the engine and sync `packs.ts`. (M)
7. **Contextual hint layer.** Anchored coach marks (ghost hand, rotate arrow), idle and stuck triggers that escalate into the existing Hint, a shown-once memory, and reduced-motion support. Replace the Hint `alert()` with an inline message. (M)
8. **Onboarding funnel analytics.** Events for tutorial start, each puzzle solved, hint shown or used, and skip, to measure the effect of cards 6–7. (S)
9. *(Optional)* **Animated loop demo on the home card.** (S–M)
10. *(Optional)* **Colour lab sandbox** linked from the colour guide. (M)
