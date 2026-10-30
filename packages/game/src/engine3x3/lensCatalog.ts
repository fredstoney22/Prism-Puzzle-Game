/**
 * Catalog of 3×3 lens shapes (docs/generation-engine-overhaul.md, LensCatalog).
 *
 * Mono catalog definition: the rotation-equivalence classes (quarter turns only,
 * no mirroring) of non-empty 3×3 activation masks. By Burnside's lemma there are
 * (2^9 + 2·2^3 + 2^5) / 4 = 140 classes including the empty mask, so 139
 * non-empty ones. Each class is represented by its smallest mask over the four
 * rotations. Colour lenses are too numerous to list (4^9 grids with primaries,
 * 8^9 with secondaries), so they are sampled and only canonicalised here.
 */

import type { Pigment } from "../types.js";
import { rotateVec, type Vec } from "./bitboard.js";

const CELLS = 9;
const MASK_COUNT = 1 << CELLS;
const LAYERS = 3;

/** Smallest Vec among the four rotations of `vec`: the rotation class's identity. */
export function canonicalLensVec(vec: Vec): Vec {
  let best = vec;
  let rotated = vec;
  for (let turn = 1; turn < 4; turn++) {
    rotated = rotateVec(rotated);
    if (rotated < best) best = rotated;
  }
  return best;
}

/** Vec of a lens whose active cells (9-bit `mask`) all carry `pigment` (1–7). */
export function maskToLensVec(mask: number, pigment: Pigment): Vec {
  let vec = 0;
  for (let layer = 0; layer < LAYERS; layer++) {
    if ((pigment >>> layer) & 1) vec |= mask << (layer * CELLS);
  }
  return vec;
}

function buildMonoClasses(): readonly number[] {
  const classes: number[] = [];
  for (let mask = 1; mask < MASK_COUNT; mask++) {
    // Layer 0 holds the mask itself, so canonicalising a pigment-1 Vec canonicalises the mask.
    if (canonicalLensVec(mask) === mask) classes.push(mask);
  }
  return classes;
}

export class LensCatalog {
  private readonly monoClasses: readonly number[];

  constructor() {
    this.monoClasses = buildMonoClasses();
  }

  /** Number of distinct non-empty mono lens classes (139). */
  get monoSize(): number {
    return this.monoClasses.length;
  }

  /** Canonical 9-bit activation masks of every mono class, ascending. */
  monoMasks(): readonly number[] {
    return this.monoClasses;
  }

  /** Canonical mono lens `index` (0..monoSize-1) coloured with `pigment`. */
  monoLens(index: number, pigment: Pigment): Vec {
    const mask = this.monoClasses[index];
    if (mask === undefined)
      throw new RangeError(`Mono lens index ${index} out of range`);
    return maskToLensVec(mask, pigment);
  }
}
