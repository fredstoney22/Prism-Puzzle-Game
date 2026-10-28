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

/** Thrown when a grid or config isn't a 3×3 board with 3×3 lenses. */
export class NotThreeByThreeError extends Error {
	constructor(what: string) {
		super(`${what} must be a 3×3 grid`);
		this.name = 'NotThreeByThreeError';
	}
}

const SIZE = 3;
const CELLS = SIZE * SIZE;
const CELL_MASK = 0x1ff;
const LAYER_BITS = [1, 2, 4] as const;

function assertThreeByThree(grid: PuzzleGrid, what: string): void {
	if (grid.length !== SIZE || grid.some((row) => row.length !== SIZE)) {
		throw new NotThreeByThreeError(what);
	}
}

/** Packs a 3×3 pigment grid into a Vec. Throws `NotThreeByThreeError` otherwise. */
export function gridToVec(grid: PuzzleGrid): Vec {
	assertThreeByThree(grid, 'Grid');
	let vec = 0;
	for (let cell = 0; cell < CELLS; cell++) {
		const pigment = grid[Math.floor(cell / SIZE)][cell % SIZE];
		LAYER_BITS.forEach((bit, layer) => {
			if (pigment & bit) vec |= 1 << (layer * CELLS + cell);
		});
	}
	return vec;
}

/** Pigment at row-major cell index 0–8 of a Vec. */
export function cellPigment(vec: Vec, cell: number): Pigment {
	let pigment = 0;
	LAYER_BITS.forEach((bit, layer) => {
		if ((vec >>> (layer * CELLS + cell)) & 1) pigment |= bit;
	});
	return pigment as Pigment;
}

/** Unpacks a Vec into a fresh 3×3 pigment grid. */
export function vecToGrid(vec: Vec): PuzzleGrid {
	const grid: PuzzleGrid = [];
	for (let r = 0; r < SIZE; r++) {
		const row: Pigment[] = [];
		for (let c = 0; c < SIZE; c++) row.push(cellPigment(vec, r * SIZE + c));
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
			for (let layer = 0; layer < LAYER_BITS.length; layer++) {
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

/** Vec of a grid where every cell holds `pigment`. */
export function uniformVec(pigment: Pigment): Vec {
	let vec = 0;
	LAYER_BITS.forEach((bit, layer) => {
		if (pigment & bit) vec |= CELL_MASK << (layer * CELLS);
	});
	return vec;
}

/** Bitboard counterpart of `isSolved`: every cell equals `solvedValue` (default clear). */
export function isSolvedVec(vec: Vec, solvedValue: Pigment = 0): boolean {
	return vec === uniformVec(solvedValue);
}

/**
 * All distinct legal moves for a lens set on a 3×3 board: each lens at each
 * rotation 0–3, skipping orientations whose Vec was already produced (rotational
 * symmetry or a duplicate lens) and empty lenses, which are no-ops.
 */
export function placementsFor(lenses: Vec[]): Placement[] {
	const placements: Placement[] = [];
	const seen = new Set<Vec>([0]);
	lenses.forEach((lensVec, lens) => {
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

/** Packs a 3×3-board / 3×3-lens `PuzzleConfig`. Throws `NotThreeByThreeError` otherwise. */
export function configToVec(config: PuzzleConfig): PuzzleVecs {
	assertThreeByThree(config.startState, 'Board');
	config.templates.forEach((t, i) => assertThreeByThree(t.shape, `Lens ${i}`));
	const vecs: PuzzleVecs = {
		start: gridToVec(config.startState),
		lenses: config.templates.map((t) => gridToVec(t.shape)),
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
