/**
 * Solution space table (SST) for one lens set (docs/generation-engine-overhaul.md §2).
 *
 * Every solution is a subset of the distinct oriented moves whose XOR equals
 * `start ^ solvedVec`. The table is keyed by that XOR ("delta"), so one table
 * answers every start state reachable with the lens set.
 */

import type { Vec } from "./bitboard.js";

/** One distinct move vector, with every lens that can produce it. */
export interface SolutionMove {
  /** First lens (lowest index) that produces this vec, used when replaying. */
  lens: number;
  /** Rotation of `lens` that produces this vec. */
  rotation: number;
  /** All lenses that own a placement with this vec (rotated or duplicate lenses share one). */
  lenses: number[];
  vec: Vec;
}

/** Statistics for one reachable delta. */
export interface SolutionEntry {
  /** Fewest moves in any solution. */
  minMoves: number;
  /** Number of solutions with exactly `minMoves` moves. */
  minSetCount: number;
  /** Number of solutions of any size (always 2^nullity). */
  totalSetCount: number;
  /** Bit `i` set = `moves[i]` is used; the lowest-valued minimal subset. */
  witnessMask: number;
}

export class SolutionSpaceTable {
  constructor(
    readonly moves: readonly SolutionMove[],
    private readonly entriesByDelta: ReadonlyMap<Vec, SolutionEntry>,
  ) {}

  /** Number of reachable deltas. */
  get size(): number {
    return this.entriesByDelta.size;
  }

  /** Entry for `start ^ solvedVec`, or undefined if the start cannot be solved. */
  lookup(delta: Vec): SolutionEntry | undefined {
    return this.entriesByDelta.get(delta);
  }

  entries(): IterableIterator<[Vec, SolutionEntry]> {
    return this.entriesByDelta.entries();
  }

  /** Moves selected by a witness mask, in move order. */
  movesOf(mask: number): SolutionMove[] {
    return this.moves.filter((_, i) => (mask >>> i) & 1);
  }

  /** True when some lens-to-move assignment of the subset credits every lens in `0..lensCount-1`. */
  usesEveryLens(mask: number, lensCount: number): boolean {
    const selected = this.movesOf(mask);
    const used = new Set<number>();
    const assign = (index: number): boolean => {
      if (used.size === lensCount) return true;
      if (index >= selected.length) return false;
      for (const lens of selected[index].lenses) {
        if (used.has(lens)) continue;
        used.add(lens);
        if (assign(index + 1)) return true;
        used.delete(lens);
      }
      return false;
    };
    return assign(0);
  }
}
