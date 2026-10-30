import { describe, expect, it } from "vitest";

import { LensCatalog, canonicalLensVec } from "./lensCatalog.js";
import { LensSamplingError, LensSetSampler } from "./lensSetSampler.js";
import { Mulberry32 } from "./rng.js";
import { rotateVec, vecToGrid, type Vec } from "./bitboard.js";

function pigmentsOf(vec: Vec): Set<number> {
  return new Set(vecToGrid(vec).flat());
}

describe("Mulberry32", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = new Mulberry32(42);
    const b = new Mulberry32(42);
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(
      Array.from({ length: 20 }, () => b.next()),
    );
  });

  it("differs across seeds and stays in range", () => {
    const a = new Mulberry32(1);
    const b = new Mulberry32(2);
    expect(a.next()).not.toBe(b.next());
    const rng = new Mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const n = rng.nextInt(5);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(5);
    }
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => new Mulberry32(1.5)).toThrow(RangeError);
  });
});

describe("LensCatalog", () => {
  const catalog = new LensCatalog();

  it("contains 139 distinct rotation classes of non-empty masks", () => {
    expect(catalog.monoSize).toBe(139);
    expect(new Set(catalog.monoMasks()).size).toBe(139);
  });

  it("has no two entries that are rotations of each other, and covers every non-empty mask", () => {
    const covered = new Set<number>();
    for (const mask of catalog.monoMasks()) {
      expect(mask).toBeGreaterThan(0);
      let v = mask;
      for (let t = 0; t < 4; t++) {
        covered.add(v);
        v = rotateVec(v);
      }
    }
    expect(covered.size).toBe(511);
  });

  it("colours a class with the requested pigment", () => {
    for (let i = 0; i < catalog.monoSize; i++) {
      const coloured = [...pigmentsOf(catalog.monoLens(i, 6))].filter(
        (p) => p !== 0,
      );
      expect(coloured).toEqual([6]);
    }
    expect(() => catalog.monoLens(139, 1)).toThrow(RangeError);
  });
});

describe("LensSetSampler", () => {
  it("produces identical sets for the same seed", () => {
    const run = () => {
      const sampler = new LensSetSampler(new Mulberry32(123));
      return Array.from({ length: 30 }, (_, i) =>
        sampler.sample({ lensCount: ((i % 3) + 1) as 1 | 2 | 3 }),
      );
    };
    expect(run()).toEqual(run());
  });

  it("varies with the seed", () => {
    const a = new LensSetSampler(new Mulberry32(1)).sample({ lensCount: 3 });
    const b = new LensSetSampler(new Mulberry32(2)).sample({ lensCount: 3 });
    expect(a).not.toEqual(b);
  });

  it("uses only R/Y/B when the secondary flag is off", () => {
    const sampler = new LensSetSampler(new Mulberry32(5));
    for (let i = 0; i < 300; i++) {
      for (const lens of sampler.sample({ lensCount: 3 })) {
        for (const p of pigmentsOf(lens)) expect([0, 1, 2, 4]).toContain(p);
      }
    }
  });

  it("can produce secondaries when the flag is on, and never otherwise", () => {
    const sampler = new LensSetSampler(new Mulberry32(5));
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      for (const lens of sampler.sample({
        lensCount: 3,
        allowSecondaryLensPigments: true,
      })) {
        pigmentsOf(lens).forEach((p) => seen.add(p));
      }
    }
    expect([3, 5, 6].every((p) => seen.has(p))).toBe(true);
    expect(seen.has(7)).toBe(false);
  });

  it("returns the requested count of non-empty, rotation-distinct canonical lenses", () => {
    const sampler = new LensSetSampler(new Mulberry32(9));
    for (const lensCount of [1, 2, 3] as const) {
      for (let i = 0; i < 100; i++) {
        const lenses = sampler.sample({ lensCount });
        expect(lenses).toHaveLength(lensCount);
        expect(new Set(lenses).size).toBe(lensCount);
        for (const lens of lenses) {
          expect(lens).not.toBe(0);
          expect(canonicalLensVec(lens)).toBe(lens);
        }
      }
    }
  });

  it("samples single-pigment palettes from the mono catalog", () => {
    const sampler = new LensSetSampler(new Mulberry32(3));
    for (let i = 0; i < 100; i++) {
      for (const lens of sampler.sample({ lensCount: 2, palette: [2] })) {
        expect(pigmentsOf(lens).has(1)).toBe(false);
        expect([...pigmentsOf(lens)].filter((p) => p !== 0)).toEqual([2]);
      }
    }
  });

  it("honours requireMultiColorLens", () => {
    const sampler = new LensSetSampler(new Mulberry32(11));
    for (let i = 0; i < 100; i++) {
      const lenses = sampler.sample({
        lensCount: 2,
        requireMultiColorLens: true,
      });
      expect(
        lenses.some(
          (l) => [...pigmentsOf(l)].filter((p) => p !== 0).length > 1,
        ),
      ).toBe(true);
    }
    expect(() =>
      sampler.sample({
        lensCount: 1,
        palette: [1],
        requireMultiColorLens: true,
      }),
    ).toThrow(LensSamplingError);
  });

  it("rejects secondary pigments in the palette and empty palettes", () => {
    const sampler = new LensSetSampler(new Mulberry32(1));
    expect(() => sampler.sample({ lensCount: 1, palette: [3] })).toThrow(
      LensSamplingError,
    );
    expect(() => sampler.sample({ lensCount: 1, palette: [] })).toThrow(
      LensSamplingError,
    );
  });
});
