/**
 * Cross-checks the bitboard solution space table against production code
 * (docs/generation-engine-overhaul.md §3): witnesses are replayed with the real
 * `applyTemplate`/`isSolved`, and `minMoves` is confirmed with `findMinMovesBfs`,
 * so a bug in the bit encoding cannot ship.
 */

import { applyTemplate, isSolved } from "../PuzzleFunctions.js";
import { findMinMovesBfs } from "../puzzleSearchSession.js";
import { orientTemplate } from "../templatePigment.js";
import type { PuzzleConfig } from "../types.js";
import { configToVec, solvedVec } from "./bitboard.js";
import type { SolutionSpaceEnumerator } from "./solutionSpaceEnumerator.js";

type MinMovesSolver = (config: PuzzleConfig, maxDepth: number) => number | null;

export interface VerificationResult {
  ok: boolean;
  /** minMoves from the SST; null when the start state cannot be solved. */
  sstMinMoves: number | null;
  /** minMoves from BFS; null when BFS finds no solution. */
  bfsMinMoves: number | null;
  failures: string[];
}

export class IndependentVerifier {
  constructor(
    private readonly enumerator: SolutionSpaceEnumerator,
    private readonly solveMinMoves: MinMovesSolver = findMinMovesBfs,
  ) {}

  verify(config: PuzzleConfig): VerificationResult {
    const vecs = configToVec(config);
    const table = this.enumerator.enumerate(vecs.lenses);
    const entry = table.lookup(vecs.start ^ solvedVec(vecs.solvedValue));
    const sstMinMoves = entry?.minMoves ?? null;
    const bfsMinMoves = this.solveMinMoves(
      config,
      Math.max(table.moves.length, 1),
    );
    const failures: string[] = [];

    if (sstMinMoves !== bfsMinMoves) {
      failures.push(
        `minMoves mismatch: SST ${sstMinMoves}, BFS ${bfsMinMoves}`,
      );
    }
    if (entry) {
      let state = config.startState;
      for (const move of table.movesOf(entry.witnessMask)) {
        const oriented = orientTemplate(
          config.templates[move.lens],
          move.rotation,
        );
        state = applyTemplate(state, oriented, 0, 0);
      }
      if (!isSolved(state, config.solvedValue))
        failures.push("witness does not solve the board");
    }
    if (
      config.minMovesToSolve !== undefined &&
      sstMinMoves !== config.minMovesToSolve
    ) {
      failures.push(
        `declared minMovesToSolve ${config.minMovesToSolve}, SST ${sstMinMoves}`,
      );
    }
    return { ok: failures.length === 0, sstMinMoves, bfsMinMoves, failures };
  }
}
