/**
 * Exact GF(2) minimum-move solver — an alternative to BFS for puzzles whose move
 * matrix has small nullity.
 *
 * `Ax = s` (mod 2) has one particular solution `x0` plus every vector in `ker(A)`
 * XORed in — `2^nullity` equivalent solutions, the "quiet patterns" reported by
 * `analyzeSolvability` in puzzleSolvability.ts. The minimum-weight one among those
 * is the puzzle's true minMoves. Gaussian elimination (`gf2RowReduce`) finds `x0`
 * and a kernel basis directly; brute-forcing `2^nullity` weight comparisons finds
 * the minimum. This replaces a BFS over the board-state graph (branching factor =
 * placement count, depth = solution length) with a search over the kernel
 * (branching factor 2, depth = nullity) — see `report-pack-nullity.ts` for the
 * empirical nullity distribution across existing color packs that motivated this
 * (median well under 10 for puzzles that actually ship).
 */
import {
	buildMoveMatrix,
	encodeStateDelta,
	gf2RowReduce,
	type PlacementMove
} from './puzzleSolvability.js';
import type { SolvabilityAnalysisOptions } from './puzzleSolvability.js';
import type { PuzzleConfig } from './types.js';
import type { SolutionMove } from './puzzleDifficulty.js';

/**
 * Above this nullity, brute-forcing 2^nullity kernel combinations stops being
 * cheap. None of the packs currently in `packs.ts` exceed this (see
 * `report-pack-nullity.ts`); a puzzle above it just isn't computed by this
 * solver — callers should fall back to BFS rather than wait. A meet-in-the-middle
 * kernel search would raise this ceiling further, but isn't needed yet.
 */
export const DEFAULT_MAX_BRUTE_FORCE_NULLITY = 20;

export interface AlgebraicSolveResult {
	minMoves: number;
	nullity: number;
}

export interface AlgebraicSolutionResult extends AlgebraicSolveResult {
	/**
	 * One minimum-weight solution, converted to player moves. XOR is commutative,
	 * so any order of these moves reaches the solved state — this array is ordered
	 * (row, col, templateIndex) for a stable, deterministic presentation, not
	 * because solving requires that order. Order-dependent metrics derived from it
	 * (e.g. colorChanges) reflect this canonical order, not necessarily what a BFS
	 * search would have found.
	 */
	solution: SolutionMove[];
	/**
	 * Count of distinct minimum-weight move SETS among the `2^nullity` solutions
	 * to `Ax = s` (1 when nullity is 0 — the solution is unique). This is a
	 * free byproduct of the same kernel scan that finds `minMoves`, and is a
	 * different quantity from puzzleForgiveness.ts's `shortestSolutionCount`,
	 * which counts distinct ordered *paths* — a single move set of size k can
	 * be walked in up to k! valid orders, so that DFS-based count is inflated
	 * by ordering combinatorics on top of genuine solution-set diversity. See
	 * generation/algebraicDifficultyEvaluator.ts for how this is used.
	 */
	minimalSolutionCount: number;
}

export interface AlgebraicSolveOptions extends SolvabilityAnalysisOptions {
	/** Skip brute force and return null above this nullity. Default {@link DEFAULT_MAX_BRUTE_FORCE_NULLITY}. */
	maxBruteForceNullity?: number;
}

interface Gf2SolveResult {
	/** One solution to Ax = target (not necessarily minimum weight). */
	particular: Uint8Array;
	/** Basis of ker(A) — one vector per free (non-pivot) column. */
	kernelBasis: Uint8Array[];
}

/** Solves `Ax = target` (mod 2) via Gaussian elimination. Null if inconsistent (no solution). */
function solveGf2System(rows: Uint8Array[], target: Uint8Array): Gf2SolveResult | null {
	const rowCount = rows.length;
	if (rowCount === 0) return { particular: new Uint8Array(0), kernelBasis: [] };

	const placementCount = rows[0].length;
	if (placementCount === 0) {
		return target.every((bit) => bit === 0)
			? { particular: new Uint8Array(0), kernelBasis: [] }
			: null;
	}

	const augmented = rows.map((row, i) => {
		const extended = new Uint8Array(placementCount + 1);
		extended.set(row);
		extended[placementCount] = target[i] ?? 0;
		return extended;
	});

	const { matrix, pivotColByRow } = gf2RowReduce(augmented, placementCount);

	for (let r = 0; r < rowCount; r++) {
		if (pivotColByRow[r] === null && matrix[r][placementCount] === 1) {
			return null; // reduced row reads "0 = 1" — inconsistent, no solution
		}
	}

	const pivotCols = new Set<number>();
	for (const col of pivotColByRow) {
		if (col !== null) pivotCols.add(col);
	}

	const particular = new Uint8Array(placementCount);
	for (let r = 0; r < rowCount; r++) {
		const p = pivotColByRow[r];
		if (p !== null) particular[p] = matrix[r][placementCount];
	}

	const kernelBasis: Uint8Array[] = [];
	for (let col = 0; col < placementCount; col++) {
		if (pivotCols.has(col)) continue;

		// Free variable `col` set to 1, every other free variable 0: each pivot row's
		// equation then forces its pivot variable to equal that row's coefficient at `col`.
		const basisVector = new Uint8Array(placementCount);
		basisVector[col] = 1;
		for (let r = 0; r < rowCount; r++) {
			const p = pivotColByRow[r];
			if (p !== null && matrix[r][col] === 1) {
				basisVector[p] = 1;
			}
		}
		kernelBasis.push(basisVector);
	}

	return { particular, kernelBasis };
}

function popcount(vector: Uint8Array): number {
	let count = 0;
	for (const bit of vector) count += bit;
	return count;
}

function xorInPlace(target: Uint8Array, other: Uint8Array): void {
	for (let i = 0; i < target.length; i++) target[i] ^= other[i];
}

function trailingZeroBit(value: number): number {
	let index = 0;
	while (((value >> index) & 1) === 0) index++;
	return index;
}

interface MinWeightSearchResult {
	vector: Uint8Array;
	/** How many of the 2^kernelBasis.length combinations tied for the minimum weight. */
	tieCount: number;
}

/**
 * Minimum-weight vector over `particular XOR (any combination of kernelBasis)`,
 * plus how many combinations tied for that minimum. Enumerates all
 * `2^kernelBasis.length` combinations via Gray code so each step is a single
 * XOR rather than rebuilding the vector from scratch.
 */
function minWeightVectorOverKernel(
	particular: Uint8Array,
	kernelBasis: Uint8Array[]
): MinWeightSearchResult {
	const current = Uint8Array.from(particular);
	let best = Uint8Array.from(current);
	let bestWeight = popcount(current);
	let tieCount = 1;
	let prevGray = 0;
	const total = 1 << kernelBasis.length;

	for (let i = 1; i < total; i++) {
		const gray = i ^ (i >> 1);
		const flipped = gray ^ prevGray;
		xorInPlace(current, kernelBasis[trailingZeroBit(flipped)]);
		const weight = popcount(current);
		if (weight < bestWeight) {
			bestWeight = weight;
			best = Uint8Array.from(current);
			tieCount = 1;
		} else if (weight === bestWeight) {
			tieCount++;
		}
		prevGray = gray;
	}

	return { vector: best, tieCount };
}

/** Converts a winning strategy vector (which placement columns are set) into player moves. */
function vectorToSolution(vector: Uint8Array, placements: PlacementMove[]): SolutionMove[] {
	const moves: SolutionMove[] = [];
	for (let i = 0; i < vector.length; i++) {
		if (vector[i] === 1) {
			const p = placements[i];
			moves.push({ templateIndex: p.templateIndex, rotation: p.rotation, row: p.row, col: p.col });
		}
	}
	// Canonical, deterministic order — see AlgebraicSolutionResult.solution doc.
	moves.sort((a, b) => a.row - b.row || a.col - b.col || a.templateIndex - b.templateIndex);
	return moves;
}

/**
 * Exact minimum-move solve via GF(2) linear algebra instead of BFS — returns the
 * actual winning move set (see {@link AlgebraicSolutionResult}), not just its size.
 *
 * Returns null when: the puzzle isn't solvable under this move set, or nullity
 * exceeds `maxBruteForceNullity` (too expensive to brute force — fall back to BFS).
 */
export function solvePuzzleAlgebraically(
	config: PuzzleConfig,
	options: AlgebraicSolveOptions = {}
): AlgebraicSolutionResult | null {
	const { includeRotations = true, maxBruteForceNullity = DEFAULT_MAX_BRUTE_FORCE_NULLITY } = options;

	const { rows, encoding, placements } = buildMoveMatrix(config, { includeRotations });
	const placementCount = rows[0]?.length ?? 0;
	const target = encodeStateDelta(config.startState, config.solvedValue, encoding);

	if (placementCount === 0) {
		return target.every((bit) => bit === 0)
			? { minMoves: 0, nullity: 0, solution: [], minimalSolutionCount: 1 }
			: null;
	}

	const solved = solveGf2System(rows, target);
	if (!solved) return null;

	const nullity = solved.kernelBasis.length;
	if (nullity > maxBruteForceNullity) {
		return null;
	}

	if (nullity === 0) {
		return {
			minMoves: popcount(solved.particular),
			nullity,
			solution: vectorToSolution(solved.particular, placements),
			minimalSolutionCount: 1
		};
	}

	const { vector: winner, tieCount } = minWeightVectorOverKernel(
		solved.particular,
		solved.kernelBasis
	);

	return {
		minMoves: popcount(winner),
		nullity,
		solution: vectorToSolution(winner, placements),
		minimalSolutionCount: tieCount
	};
}

/**
 * Exact minimum move count via GF(2) linear algebra instead of BFS. Thin wrapper
 * over {@link solvePuzzleAlgebraically} for callers that only need the count
 * (e.g. the injectable MinMovesSolver) — see that function's doc for null cases.
 */
export function solveMinMovesAlgebraic(
	config: PuzzleConfig,
	options: AlgebraicSolveOptions = {}
): AlgebraicSolveResult | null {
	const result = solvePuzzleAlgebraically(config, options);
	return result ? { minMoves: result.minMoves, nullity: result.nullity } : null;
}
