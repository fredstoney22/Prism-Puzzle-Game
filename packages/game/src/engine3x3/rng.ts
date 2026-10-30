/**
 * Seeded pseudo-random numbers for reproducible puzzle creation
 * (docs/generation-engine-overhaul.md, LensSetSampler). Same seed, same sequence.
 */

/** Source of uniform random numbers; injected so tests and callers control determinism. */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, bound). Throws `RangeError` unless `bound` is a positive integer. */
  nextInt(bound: number): number;
}

/** mulberry32: a small, fast 32-bit seeded generator. */
export class Mulberry32 implements Rng {
  private state: number;

  constructor(seed: number) {
    if (!Number.isInteger(seed))
      throw new RangeError(`Seed ${seed} must be an integer`);
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(bound: number): number {
    if (!Number.isInteger(bound) || bound < 1) {
      throw new RangeError(`Bound ${bound} must be a positive integer`);
    }
    return Math.floor(this.next() * bound);
  }
}
