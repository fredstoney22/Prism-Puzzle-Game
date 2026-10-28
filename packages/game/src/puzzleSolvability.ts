/**
 * GF(2) solvability analysis for Flip puzzles.
 *
 * Models masked XOR mechanics as Ax = s (mod 2), where s is the start state
 * relative to the puzzle solved value and columns of A are lens placements.
 */

import { orientTemplate } from './templatePigment.js';
import { isMonochromeFlipPuzzle } from './puzzleNormalize.js';
import type { Pigment, PuzzleConfig, PuzzleGrid, PuzzleTemplate } from './types.js';

export type SolvabilityEncoding = 'mono-bit' | 'ryb-layers';

export interface SolvabilityReport {
	/** `N²` (mono) or `3N²` (RYB primary bit layers). */
	stateDimension: number;
	placementCount: number;
	rank: number;
	nullity: number;
	/** Fraction of state space reachable from lens placements: `2^rank / 2^stateDimension`. */
	solvableFraction: number;
	/** Whether `startState` can be cleared to `solvedValue` using the lens set. */
	isStartSolvable: boolean;
	/** Whether the start state already equals the solved value. */
	isStartSolved: boolean;
	/** `2^nullity` distinct placement strategies when solvable (kernel dimension). */
	quietPatternCount: number;
	encoding: SolvabilityEncoding;
}

export interface SolvabilityAnalysisOptions {
	includeRotations?: boolean;
}

/** One column of the move matrix, with enough info to render back as a player move. */
export interface PlacementMove {
	templateIndex: number;
	/** Clockwise quarter turns from the stencil's default orientation. */
	rotation: number;
	template: PuzzleTemplate;
	row: number;
	col: number;
}

interface MoveMatrix {
	encoding: SolvabilityEncoding;
	stateDimension: number;
	/** Row-major GF(2) matrix: `stateDimension × placementCount`. */
	rows: Uint8Array[];
	/** Column `i` of `rows` is the placement `placements[i]`. */
	placements: PlacementMove[];
}

function enumeratePlacements(
	puzzleSize: number,
	templates: PuzzleTemplate[],
	includeRotations: boolean
): PlacementMove[] {
	const moves: PlacementMove[] = [];

	for (let templateIndex = 0; templateIndex < templates.length; templateIndex++) {
		const base = templates[templateIndex];
		const orientations: { template: PuzzleTemplate; rotation: number }[] = [];
		const seenShapes = new Set<string>();

		const rotationCount = includeRotations ? 4 : 1;
		for (let rotation = 0; rotation < rotationCount; rotation++) {
			const oriented = orientTemplate(base, rotation);
			const key = oriented.shape.map((row) => row.join('')).join('|');
			if (!seenShapes.has(key)) {
				seenShapes.add(key);
				orientations.push({ template: oriented, rotation });
			}
		}

		for (const { template: oriented, rotation } of orientations) {
			const tRows = oriented.shape.length;
			const tCols = oriented.shape[0]?.length ?? 0;
			for (let row = 0; row <= puzzleSize - tRows; row++) {
				for (let col = 0; col <= puzzleSize - tCols; col++) {
					moves.push({ templateIndex, rotation, template: oriented, row, col });
				}
			}
		}
	}

	return moves;
}

function resolveEncoding(config: PuzzleConfig): SolvabilityEncoding {
	return isMonochromeFlipPuzzle(config) ? 'mono-bit' : 'ryb-layers';
}

function flatCellIndex(row: number, col: number, size: number): number {
	return row * size + col;
}

export function encodeStateDelta(
	startState: PuzzleGrid,
	solvedValue: Pigment,
	encoding: SolvabilityEncoding
): Uint8Array {
	const size = startState.length;
	const cellCount = size * size;

	if (encoding === 'mono-bit') {
		const vector = new Uint8Array(cellCount);
		for (let r = 0; r < size; r++) {
			for (let c = 0; c < size; c++) {
				vector[flatCellIndex(r, c, size)] = (startState[r][c] ^ solvedValue) & 1;
			}
		}
		return vector;
	}

	const vector = new Uint8Array(cellCount * 3);
	for (let r = 0; r < size; r++) {
		for (let c = 0; c < size; c++) {
			const delta = (startState[r][c] ^ solvedValue) & 0b111;
			const base = flatCellIndex(r, c, size);
			vector[base] = delta & 1;
			vector[cellCount + base] = (delta >> 1) & 1;
			vector[cellCount * 2 + base] = (delta >> 2) & 1;
		}
	}
	return vector;
}

function buildPlacementColumn(
	move: PlacementMove,
	size: number,
	encoding: SolvabilityEncoding
): Uint8Array {
	const cellCount = size * size;
	const stateDimension = encoding === 'mono-bit' ? cellCount : cellCount * 3;
	const column = new Uint8Array(stateDimension);
	const { template, row: startRow, col: startCol } = move;

	for (let tr = 0; tr < template.shape.length; tr++) {
		for (let tc = 0; tc < template.shape[tr].length; tc++) {
			const pigment = template.shape[tr][tc];
			if (pigment === 0) continue;

			const gridR = startRow + tr;
			const gridC = startCol + tc;
			const cellIndex = flatCellIndex(gridR, gridC, size);

			if (encoding === 'mono-bit') {
				column[cellIndex] = 1;
				continue;
			}

			for (let bit = 0; bit < 3; bit++) {
				if ((pigment >> bit) & 1) {
					column[bit * cellCount + cellIndex] = 1;
				}
			}
		}
	}

	return column;
}

/** Builds the GF(2) move matrix for a puzzle configuration. */
export function buildMoveMatrix(
	config: PuzzleConfig,
	options: SolvabilityAnalysisOptions = {}
): MoveMatrix {
	const { includeRotations = true } = options;
	const size = config.startState.length;
	const encoding = resolveEncoding(config);
	const placements = enumeratePlacements(size, config.templates, includeRotations);
	const stateDimension = encoding === 'mono-bit' ? size * size : size * size * 3;

	if (placements.length === 0) {
		return { encoding, stateDimension, rows: [], placements: [] };
	}

	const columns = placements.map((move) => buildPlacementColumn(move, size, encoding));
	const rows: Uint8Array[] = Array.from({ length: stateDimension }, (_, rowIndex) => {
		const row = new Uint8Array(placements.length);
		for (let colIndex = 0; colIndex < placements.length; colIndex++) {
			row[colIndex] = columns[colIndex][rowIndex];
		}
		return row;
	});

	return { encoding, stateDimension, rows, placements };
}

export interface Gf2RowReduceResult {
	/** Row-reduced matrix (RREF within the searched pivot columns). */
	matrix: Uint8Array[];
	/** Pivot column for each row, or null if that row never became a pivot row. */
	pivotColByRow: (number | null)[];
	rank: number;
}

/**
 * Full GF(2) row reduction (RREF), searching for pivots only within the first
 * `pivotSearchColCount` columns. Extra trailing columns (e.g. an augmented target
 * vector — see puzzleAlgebraicSolver.ts) are carried along by the row operations
 * but never chosen as pivots. Exposed (not just a rank count) so callers can also
 * read off a particular solution and a kernel basis from the reduced matrix.
 */
export function gf2RowReduce(rows: Uint8Array[], pivotSearchColCount: number): Gf2RowReduceResult {
	const rowCount = rows.length;
	if (rowCount === 0) return { matrix: [], pivotColByRow: [], rank: 0 };

	const totalCols = rows[0].length;
	const matrix = rows.map((row) => Uint8Array.from(row));
	const pivotColByRow: (number | null)[] = new Array(rowCount).fill(null);
	let rank = 0;

	for (let col = 0; col < pivotSearchColCount && rank < rowCount; col++) {
		let pivotRow = -1;
		for (let r = rank; r < rowCount; r++) {
			if (matrix[r][col] === 1) {
				pivotRow = r;
				break;
			}
		}
		if (pivotRow === -1) continue;

		if (pivotRow !== rank) {
			const tmp = matrix[rank];
			matrix[rank] = matrix[pivotRow];
			matrix[pivotRow] = tmp;
		}

		for (let r = 0; r < rowCount; r++) {
			if (r !== rank && matrix[r][col] === 1) {
				for (let j = col; j < totalCols; j++) {
					matrix[r][j] ^= matrix[rank][j];
				}
			}
		}

		pivotColByRow[rank] = col;
		rank++;
	}

	return { matrix, pivotColByRow, rank };
}

function gf2Rank(rows: Uint8Array[]): number {
	if (rows.length === 0) return 0;
	const colCount = rows[0].length;
	if (colCount === 0) return 0;
	return gf2RowReduce(rows, colCount).rank;
}

function isZeroVector(vector: Uint8Array): boolean {
	return vector.every((bit) => bit === 0);
}

function isInColumnSpace(rows: Uint8Array[], target: Uint8Array): boolean {
	if (isZeroVector(target)) return true;
	if (rows.length === 0) return false;

	const augmented = rows.map((row, rowIndex) => {
		const extended = new Uint8Array(row.length + 1);
		extended.set(row);
		extended[row.length] = target[rowIndex] ?? 0;
		return extended;
	});

	const rankA = gf2Rank(rows);
	const rankAugmented = gf2Rank(augmented);
	return rankA === rankAugmented;
}

/** Pure-function entry point for GF(2) solvability analysis. */
export function analyzeSolvability(
	config: PuzzleConfig,
	options: SolvabilityAnalysisOptions = {}
): SolvabilityReport {
	const encoding = resolveEncoding(config);
	const target = encodeStateDelta(config.startState, config.solvedValue, encoding);
	const { rows, stateDimension } = buildMoveMatrix(config, options);
	const placementCount = rows[0]?.length ?? 0;
	const isStartSolved = isZeroVector(target);

	if (placementCount === 0) {
		return {
			stateDimension,
			placementCount: 0,
			rank: 0,
			nullity: 0,
			solvableFraction: stateDimension === 0 ? 1 : Math.pow(2, -stateDimension),
			isStartSolvable: isStartSolved,
			isStartSolved,
			quietPatternCount: isStartSolved ? 1 : 0,
			encoding
		};
	}

	const rank = gf2Rank(rows);
	const nullity = placementCount - rank;
	const isStartSolvable = isStartSolved || isInColumnSpace(rows, target);

	return {
		stateDimension,
		placementCount,
		rank,
		nullity,
		solvableFraction: Math.pow(2, rank - stateDimension),
		isStartSolvable,
		isStartSolved,
		quietPatternCount: isStartSolvable ? Math.pow(2, nullity) : 0,
		encoding
	};
}
