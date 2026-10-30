/**
 * Seeded sampler of 1–3 lens sets for the 3×3 engine
 * (docs/generation-engine-overhaul.md, LensSetSampler).
 *
 * Lens cells use the palette's primaries (R/Y/B) by default; secondaries
 * (3/5/6) are only added when `allowSecondaryLensPigments` is set. A single
 * pigment palette without the secondary lever samples from the precomputed
 * mono catalog; anything else samples random colour grids. Lenses in one set
 * are pairwise distinct under rotation, so none is a rotated copy of another.
 * Lens hygiene (containment, minimum cells) is the triviality filter's job.
 */

import type { Pigment } from "../types.js";
import type { Vec } from "./bitboard.js";
import { canonicalLensVec, LensCatalog } from "./lensCatalog.js";
import type { Rng } from "./rng.js";

export const PRIMARY_PIGMENTS: readonly Pigment[] = [1, 2, 4];
export const SECONDARY_PIGMENTS: readonly Pigment[] = [3, 5, 6];

const CELLS = 9;
const MAX_ATTEMPTS = 1000;

export interface LensSetOptions {
  lensCount: 1 | 2 | 3;
  /** Lens pigments to draw from; must be primaries (1, 2, 4). Defaults to all three. */
  palette?: readonly Pigment[];
  /** Optional difficulty lever: also allow 3/5/6 on lenses. */
  allowSecondaryLensPigments?: boolean;
  /** Require at least one lens with two or more distinct pigments. */
  requireMultiColorLens?: boolean;
}

/** Thrown for unsupported options or when no valid set was found. */
export class LensSamplingError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "LensSamplingError";
  }
}

function distinctPigments(vec: Vec): number {
  const seen = new Set<number>();
  for (let cell = 0; cell < CELLS; cell++) {
    let pigment = 0;
    for (let layer = 0; layer < 3; layer++)
      pigment |= ((vec >>> (layer * CELLS + cell)) & 1) << layer;
    if (pigment !== 0) seen.add(pigment);
  }
  return seen.size;
}

export class LensSetSampler {
  constructor(
    private readonly rng: Rng,
    private readonly catalog: LensCatalog = new LensCatalog(),
  ) {}

  /** Returns `lensCount` canonical, rotation-distinct lens Vecs. */
  sample(options: LensSetOptions): Vec[] {
    const pigments = this.resolvePigments(options);
    const isMono = pigments.length === 1;
    if (isMono && options.requireMultiColorLens) {
      throw new LensSamplingError(
        "A multi-colour lens needs more than one pigment",
      );
    }
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const lenses = this.drawSet(options.lensCount, pigments, isMono);
      if (lenses === null) continue;
      if (
        options.requireMultiColorLens &&
        !lenses.some((l) => distinctPigments(l) > 1)
      )
        continue;
      return lenses;
    }
    throw new LensSamplingError(
      "No valid lens set found within the attempt budget",
    );
  }

  private resolvePigments(options: LensSetOptions): Pigment[] {
    const palette = options.palette ?? PRIMARY_PIGMENTS;
    if (palette.length === 0)
      throw new LensSamplingError("Palette must not be empty");
    for (const pigment of palette) {
      if (!PRIMARY_PIGMENTS.includes(pigment)) {
        throw new LensSamplingError(
          `Palette pigment ${pigment} is not a primary; use allowSecondaryLensPigments`,
        );
      }
    }
    const pigments = [...new Set(palette)];
    return options.allowSecondaryLensPigments
      ? [...pigments, ...SECONDARY_PIGMENTS]
      : pigments;
  }

  private drawSet(
    count: number,
    pigments: Pigment[],
    isMono: boolean,
  ): Vec[] | null {
    const lenses: Vec[] = [];
    for (let i = 0; i < count; i++) {
      const lens = isMono
        ? this.drawMono(pigments[0])
        : this.drawColor(pigments);
      if (lens === null || lenses.includes(lens)) return null;
      lenses.push(lens);
    }
    return lenses;
  }

  private drawMono(pigment: Pigment): Vec {
    return this.catalog.monoLens(
      this.rng.nextInt(this.catalog.monoSize),
      pigment,
    );
  }

  /** Each cell is clear or one of `pigments`; null if the grid came out empty. */
  private drawColor(pigments: Pigment[]): Vec | null {
    let vec = 0;
    for (let cell = 0; cell < CELLS; cell++) {
      const pick = this.rng.nextInt(pigments.length + 1);
      if (pick === 0) continue;
      const pigment = pigments[pick - 1];
      for (let layer = 0; layer < 3; layer++) {
        if ((pigment >>> layer) & 1) vec |= 1 << (layer * CELLS + cell);
      }
    }
    return vec === 0 ? null : canonicalLensVec(vec);
  }
}
