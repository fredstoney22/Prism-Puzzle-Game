import { describe, expect, it } from "vitest";

import { packs } from "../packs.js";
import { findMinMovesBfs } from "../puzzleSearchSession.js";
import type {
  Pigment,
  PuzzleConfig,
  PuzzleGrid,
  PuzzleTemplate,
} from "../types.js";
import { gridToVec, rotateVec, solvedVec, vecToGrid } from "./bitboard.js";
import { IndependentVerifier } from "./independentVerifier.js";
import { SolutionSpaceEnumerator } from "./solutionSpaceEnumerator.js";

const TRIALS = 150;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGrid(rand: () => number, maxPigment: number): PuzzleGrid {
  return [0, 1, 2].map(() =>
    [0, 1, 2].map(() => Math.floor(rand() * (maxPigment + 1)) as Pigment),
  );
}

/** A reachable start: solved board with a random subset of oriented lenses applied. */
function randomConfig(rand: () => number): PuzzleConfig {
  const lensCount = 1 + Math.floor(rand() * 3);
  const templates: PuzzleTemplate[] = [];
  for (let i = 0; i < lensCount; i++)
    templates.push({ shape: randomGrid(rand, 7) });
  const solvedValue: Pigment = rand() < 0.8 ? 0 : 1;
  // Sometimes reachable, sometimes arbitrary (possibly unsolvable).
  let start = solvedVec(solvedValue);
  if (rand() < 0.5) {
    for (const template of templates) {
      let vec = gridToVec(template.shape);
      const turns = Math.floor(rand() * 4);
      for (let i = 0; i < turns; i++) vec = rotateVec(vec);
      if (rand() < 0.7) start ^= vec;
    }
  } else {
    start = gridToVec(randomGrid(rand, 7));
  }
  return { startState: vecToGrid(start), templates, solvedValue };
}

describe("SolutionSpaceEnumerator", () => {
  const enumerator = new SolutionSpaceEnumerator();

  it("records the empty subset as the zero-move solution", () => {
    const table = enumerator.enumerate([
      gridToVec([
        [1, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ]);
    expect(table.lookup(0)).toEqual({
      minMoves: 0,
      minSetCount: 1,
      totalSetCount: 1,
      witnessMask: 0,
    });
  });

  it("counts solutions as 2^nullity for every reachable state", () => {
    // Two rotations of a single-cell lens plus a bar: placements are linearly dependent.
    const corner = gridToVec([
      [1, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    const row = gridToVec([
      [1, 1, 1],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    const table = enumerator.enumerate([corner, row]);
    const total = [...table.entries()].reduce(
      (sum, [, e]) => sum + e.totalSetCount,
      0,
    );
    expect(total).toBe(2 ** table.moves.length);
    const nullity = table.moves.length - Math.log2(table.size);
    for (const [, entry] of table.entries())
      expect(entry.totalSetCount).toBe(2 ** nullity);
  });

  it("merges rotated or duplicate lenses into one move owned by each lens", () => {
    const lens = gridToVec([
      [1, 1, 0],
      [1, 0, 0],
      [0, 0, 0],
    ]);
    const table = enumerator.enumerate([lens, rotateVec(lens)]);
    expect(table.moves).toHaveLength(4);
    for (const move of table.moves) expect(move.lenses).toEqual([0, 1]);
  });

  it("SST minMoves equals BFS minMoves on random lens sets", () => {
    const rand = mulberry32(11);
    for (let i = 0; i < TRIALS; i++) {
      const config = randomConfig(rand);
      const table = enumerator.enumerate(
        config.templates.map((t) => gridToVec(t.shape)),
      );
      const start =
        gridToVec(config.startState) ^ solvedVec(config.solvedValue);
      const sst = table.lookup(start)?.minMoves ?? null;
      expect(sst).toBe(findMinMovesBfs(config, 12));
    }
  });
});

describe("IndependentVerifier", () => {
  const verifier = new IndependentVerifier(new SolutionSpaceEnumerator());

  it("replays witnesses with applyTemplate and agrees with BFS on random puzzles", () => {
    const rand = mulberry32(21);
    for (let i = 0; i < TRIALS; i++) {
      const result = verifier.verify(randomConfig(rand));
      expect(result.failures).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it("agrees on every shipped puzzle whose board and lenses are all 3x3", () => {
    let checked = 0;
    for (const pack of packs) {
      for (const config of Object.values(pack.puzzles)) {
        const is3x3 =
          config.startState.length === 3 &&
          config.startState.every((row) => row.length === 3) &&
          config.templates.every(
            (t) => t.shape.length === 3 && t.shape.every((r) => r.length === 3),
          );
        if (!is3x3) continue;
        checked++;
        const result = verifier.verify(config);
        expect(result.failures, `${pack.slug}`).toEqual([]);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("reports a minMoves mismatch", () => {
    const config: PuzzleConfig = {
      startState: [
        [1, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      templates: [
        {
          shape: [
            [1, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
          ],
        },
      ],
      solvedValue: 0,
    };
    const liar = new IndependentVerifier(
      new SolutionSpaceEnumerator(),
      () => 5,
    );
    const result = liar.verify(config);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toMatch(/minMoves/);
  });

  it("treats an unreachable start as agreeing (both null)", () => {
    const config: PuzzleConfig = {
      startState: [
        [1, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      templates: [
        {
          shape: [
            [0, 0, 0],
            [0, 2, 0],
            [0, 0, 0],
          ],
        },
      ],
      solvedValue: 0,
    };
    const result = verifier.verify(config);
    expect(result).toMatchObject({
      ok: true,
      sstMinMoves: null,
      bfsMinMoves: null,
    });
  });
});
