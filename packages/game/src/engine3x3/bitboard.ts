/**
 * Bitboard core for the 3×3-board / 3×3-lens creation engine
 * (docs/generation-engine-overhaul.md §2–§3).
 *
 * A 3×3 grid of 3-bit pigments is packed into one 27-bit integer (`Vec`):
 * bit `i` = red layer of cell `i`, bit `9 + i` = yellow, bit `18 + i` = blue,
 * with cells numbered row-major 0–8. On a 3×3 board a 3×3 lens has exactly one
 * position per rotation, so applying a move is a single `state ^ placement.vec`.
 *
 * Pure functions only; equivalence with production `applyTemplate` / `isSolved`
 * is covered by property tests in `bitboard.test.ts`.
 */

import type { Pigment, PuzzleConfig, PuzzleGrid } from '../types.js';

/** 27-bit packed 3×3 pigment grid (3 RYB bit-layers × 9 cells). */
export type Vec = number;

/** One legal move on a 3×3 board: a lens at one rotation (top-left is always (0,0)). */
export interface Placement {
	/** Index of the lens in the puzzle's template list. */
	lens: number;
	/** Clockwise quarter turns, 0–3 (same meaning as `orientTemplate`). */
	rotation: number;
	/** The oriented lens as a Vec; applying the move is `state ^ vec`. */
	vec: Vec;
}

/** A `PuzzleConfig` with its board and lenses packed as Vecs. */
export interface PuzzleVecs {
	start: Vec;
	lenses: Vec[];
	solvedValue: Pigment;
	minMovesToSolve?: number;
}

/** Thrown when a grid isn't a 3×3 grid of integer pigments 0–7. */
export class InvalidGridError extends Error {
	constructor(what: string, reason: string) {
		super(`${what} ${reason}`);
		this.name = 'InvalidGridError';
	}
}

const SIZE = 3;
const CELLS = SIZE * SIZE;
const CELL_MASK = 0x1ff;
const LAYERS = 3;

function isPigment(value: unknown): value is Pigment {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 7;
}

/** Pigment at row-major cell 0–8 of a Vec. Module-private: callers pass in-range cells. */
function pigmentAt(vec: Vec, cell: number): Pigment {
	let pigment = 0;
	for (let layer = 0; layer < LAYERS; layer++) {
		pigment |= ((vec >>> (layer * CELLS + cell)) & 1) << layer;
	}
	return pigment as Pigment;
}

/**
 * Packs a 3×3 pigment grid (board or lens) into a Vec. Throws `InvalidGridError`,
 * prefixed with `what`, for a missing row, wrong dimensions, or a cell that isn't
 * an integer pigment 0–7.
 */
export function gridToVec(grid: PuzzleGrid, what = 'Grid'): Vec {
	if (!Array.isArray(grid) || grid.length !== SIZE) {
		throw new InvalidGridError(what, 'must be a 3×3 grid');
	}
	let vec = 0;
	for (let r = 0; r < SIZE; r++) {
		const row: unknown = grid[r];
		if (!Array.isArray(row) || row.length !== SIZE) {
			throw new InvalidGridError(what, 'must be a 3×3 grid');
		}
		for (let c = 0; c < SIZE; c++) {
			const pigment: unknown = row[c];
			if (!isPigment(pigment)) {
				throw new InvalidGridError(what, `has an invalid pigment at (${r},${c})`);
			}
			for (let layer = 0; layer < LAYERS; layer++) {
				if ((pigment >>> layer) & 1) vec |= 1 << (layer * CELLS + r * SIZE + c);
			}
		}
	}
	return vec;
}

/** Unpacks a Vec into a fresh 3×3 pigment grid. */
export function vecToGrid(vec: Vec): PuzzleGrid {
	const grid: PuzzleGrid = [];
	for (let r = 0; r < SIZE; r++) {
		const row: Pigment[] = [];
		for (let c = 0; c < SIZE; c++) row.push(pigmentAt(vec, r * SIZE + c));
		grid.push(row);
	}
	return grid;
}

/** Rotates a Vec 90° clockwise (matches `orientTemplate(t, 1)`): new[r][c] = old[2-c][r]. */
export function rotateVec(vec: Vec): Vec {
	let out = 0;
	for (let r = 0; r < SIZE; r++) {
		for (let c = 0; c < SIZE; c++) {
			const from = (SIZE - 1 - c) * SIZE + r;
			const to = r * SIZE + c;
			for (let layer = 0; layer < LAYERS; layer++) {
				if ((vec >>> (layer * CELLS + from)) & 1) out |= 1 << (layer * CELLS + to);
			}
		}
	}
	return out;
}

/** Number of set bits in a 32-bit integer. */
export function popcount(value: number): number {
	let v = value - ((value >>> 1) & 0x55555555);
	v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
	return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** 9-bit mask of cells (0–8) that are not clear (pigment ≠ 0). */
export function dirtyCells(vec: Vec): number {
	return (vec | (vec >>> CELLS) | (vec >>> (2 * CELLS))) & CELL_MASK;
}

function uniformVec(pigment: number): Vec {
	let vec = 0;
	for (let layer = 0; layer < LAYERS; layer++) {
		if ((pigment >>> layer) & 1) vec |= CELL_MASK << (layer * CELLS);
	}
	return vec;
}

/** Vec of a board with every cell set to pigment `p`, indexed by `p`. */
const UNIFORM_VECS: readonly Vec[] = [0, 1, 2, 3, 4, 5, 6, 7].map(uniformVec);

/** Bitboard counterpart of `isSolved`: every cell equals `solvedValue` (default clear). */
export function isSolvedVec(vec: Vec, solvedValue: Pigment = 0): boolean {
	return vec === UNIFORM_VECS[solvedValue];
}

/**
 * All legal moves for a lens set on a 3×3 board: each lens at each of its
 * distinct rotations 0–3. Dedup is per lens (rotational symmetry only), so every
 * non-empty lens owns its own placements even when it is a rotation or copy of
 * another lens; those placements then share a `vec`. Empty lenses are no-ops and
 * get no placements.
 */
export function placementsFor(lenses: Vec[]): Placement[] {
	const placements: Placement[] = [];
	lenses.forEach((lensVec, lens) => {
		if (lensVec === 0) return;
		const seen = new Set<Vec>();
		let vec = lensVec;
		for (let rotation = 0; rotation < 4; rotation++) {
			if (!seen.has(vec)) {
				seen.add(vec);
				placements.push({ lens, rotation, vec });
			}
			vec = rotateVec(vec);
		}
	});
	return placements;
}

/** Packs a 3×3-board / 3×3-lens `PuzzleConfig`. Throws `InvalidGridError` otherwise. */
export function configToVec(config: PuzzleConfig): PuzzleVecs {
	const vecs: PuzzleVecs = {
		start: gridToVec(config.startState, 'Board'),
		lenses: config.templates.map((t, i) => gridToVec(t.shape, `Lens ${i}`)),
		solvedValue: config.solvedValue
	};
	if (config.minMovesToSolve !== undefined) vecs.minMovesToSolve = config.minMovesToSolve;
	return vecs;
}

/** Unpacks Vecs into the existing `PuzzleConfig` shape (inverse of `configToVec`). */
export function vecToConfig(vecs: PuzzleVecs): PuzzleConfig {
	const config: PuzzleConfig = {
		startState: vecToGrid(vecs.start),
		templates: vecs.lenses.map((lens) => ({ shape: vecToGrid(lens) })),
		solvedValue: vecs.solvedValue
	};
	if (vecs.minMovesToSolve !== undefined) config.minMovesToSolve = vecs.minMovesToSolve;
	return config;
}
