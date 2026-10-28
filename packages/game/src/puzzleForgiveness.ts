/**
 * Forgiveness / redundancy metrics — puzzles with many near-optimal paths feel easier.
 */

import { countSolutionCellApplications } from './solutionGridCoverage.js';
import { applyTemplate, isSolved } from './PuzzleFunctions.js';
import { solveMinMoves } from './puzzleSolver.js';
import { gridToKey } from './puzzleGrid.js';
import { orientTemplate } from './templatePigment.js';
import type { PuzzleConfig, PuzzleGrid, PuzzleTemplate } from './types.js';
import type { SolutionMove } from './puzzleDifficulty.js';

export interface ForgivenessMetrics {
	/** Non-solved cells in the start state. */
	hammingWeight: number;
	/** First moves after which the puzzle still solves within minMoves + 1 total. */
	generousFirstMoveCount: number;
	totalFirstMoves: number;
	/** 0–1; higher means more forgiving openings. */
	generousFirstMoveRate: number;
	/** Distinct solution paths of length exactly minMoves (capped). */
	shortestSolutionCount: number;
	/** Distinct solution paths of length exactly minMoves + 1 (capped). */
	nearOptimalSolutionCount: number;
	/** True when path counts hit the computation cap. */
	solutionCountCapped: boolean;
	/** Distinct cells touched on the shortest solution path. */
	cellsTouchedBySolution: number;
	/** Cells hit exactly once on the shortest solution. */
	cellsTouchedOnce: number;
	/** Cells hit two or more times on the shortest solution (coupling). */
	cellsTouchedMultiple: number;
	/** Peak stencil overlap on any cell in the shortest solution. */
	maxApplicationsPerCell: number;
	/** cellsTouchedMultiple / cellsTouchedBySolution. */
	overlapDensity: number;
}

export interface ForgivenessOptions {
	/** Stop counting solution paths after this many (default 1000). */
	pathCountCap?: number;
	maxDepth?: number;
	/**
	 * Count paths of length minMoves + 1 (expensive on 3×3 color puzzles).
	 * Default false — enable only for `full` difficulty profile / offline analysis.
	 */
	includeNearOptimalPaths?: boolean;
	/**
	 * BFS per opening move for generous-first-move rate (expensive).
	 * Default false — enable only for `full` difficulty profile / offline analysis.
	 */
	includeGenerousFirstMoves?: boolean;
	/** When set, estimate generosity from a random sample of opening moves. */
	sampleFirstMoves?: number;
	/**
	 * Skip the exhaustive DFS for `shortestSolutionCount` and use this value
	 * instead — for callers that already have a cheaper, exact-but-differently-
	 * defined count (e.g. the algebraic evaluator's count of distinct minimal
	 * move SETS, vs. this DFS's count of distinct ordered paths). Also disables
	 * `solutionCountCapped`'s DFS-cap contribution, since this isn't DFS-capped.
	 */
	shortestSolutionCountOverride?: number;
}

interface InternalMove {
	templateIndex: number;
	rotation: number;
	template: PuzzleTemplate;
	row: number;
	col: number;
}

const DEFAULT_PATH_COUNT_CAP = 1000;

function enumerateMoves(puzzleSize: number, templates: PuzzleTemplate[]): InternalMove[] {
	const moves: InternalMove[] = [];

	for (let templateIndex = 0; templateIndex < templates.length; templateIndex++) {
		const base = templates[templateIndex];
		const orientations: { template: PuzzleTemplate; rotation: number }[] = [];
		const seen = new Set<string>();

		for (let rotation = 0; rotation < 4; rotation++) {
			const oriented = orientTemplate(base, rotation);
			const key = oriented.shape.map((row) => row.join('')).join('|');
			if (!seen.has(key)) {
				seen.add(key);
				orientations.push({ template: oriented, rotation });
			}
		}

		for (const { template, rotation } of orientations) {
			const tRows = template.shape.length;
			const tCols = template.shape[0]?.length ?? 0;
			for (let row = 0; row <= puzzleSize - tRows; row++) {
				for (let col = 0; col <= puzzleSize - tCols; col++) {
					moves.push({ templateIndex, rotation, template, row, col });
				}
			}
		}
	}

	return moves;
}

function hammingWeight(config: PuzzleConfig): number {
	return config.startState
		.flat()
		.filter((cell) => cell !== config.solvedValue).length;
}

function countSolutionPaths(
	config: PuzzleConfig,
	pathLength: number,
	moves: InternalMove[],
	cap: number
): number {
	const { startState, solvedValue } = config;
	let count = 0;

	function dfs(grid: PuzzleGrid, depth: number): boolean {
		if (count >= cap) return true;

		if (isSolved(grid, solvedValue)) {
			if (depth === pathLength) count++;
			return count >= cap;
		}

		if (depth >= pathLength) return false;

		const seen = new Set<string>();
		for (const move of moves) {
			const next = applyTemplate(grid, move.template, move.row, move.col);
			const key = gridToKey(next);
			if (seen.has(key)) continue;
			seen.add(key);
			if (dfs(next, depth + 1)) return true;
		}

		return false;
	}

	dfs(
		startState.map((row) => [...row]),
		0
	);

	return count;
}

function sampleMoves(moves: InternalMove[], sampleSize?: number): InternalMove[] {
	if (!sampleSize || sampleSize >= moves.length) return moves;
	const stride = Math.max(1, Math.floor(moves.length / sampleSize));
	const sampled: InternalMove[] = [];
	for (let i = 0; i < moves.length && sampled.length < sampleSize; i += stride) {
		sampled.push(moves[i]);
	}
	return sampled;
}

function countGenerousFirstMoves(
	config: PuzzleConfig,
	minMoves: number,
	moves: InternalMove[],
	maxDepth: number,
	sampleSize?: number
): { generousFirstMoveCount: number; totalFirstMoves: number } {
	const { startState } = config;
	const sampled = sampleMoves(moves, sampleSize);
	let generousFirstMoveCount = 0;

	for (const move of sampled) {
		const nextState = applyTemplate(startState, move.template, move.row, move.col);
		const remaining = solveMinMoves(
			{ ...config, startState: nextState },
			Math.min(maxDepth - 1, minMoves + 2)
		);
		if (remaining !== null && remaining + 1 <= minMoves + 1) {
			generousFirstMoveCount++;
		}
	}

	const scale =
		sampleSize && sampleSize < moves.length
			? moves.length / sampled.length
			: 1;

	return {
		generousFirstMoveCount: Math.round(generousFirstMoveCount * scale),
		totalFirstMoves: moves.length
	};
}

export function evaluateForgivenessMetrics(
	config: PuzzleConfig,
	minMoves: number,
	solution: SolutionMove[],
	options: ForgivenessOptions = {}
): ForgivenessMetrics {
	const cap = options.pathCountCap ?? DEFAULT_PATH_COUNT_CAP;
	const maxDepth = options.maxDepth ?? Math.max(minMoves + 2, 12);
	const size = config.startState.length;
	const moves = enumerateMoves(size, config.templates);
	const totalFirstMoves = moves.length;
	const includeNearOptimal =
		(options.includeNearOptimalPaths ?? false) && size <= 3;
	const includeGenerousFirstMoves = options.includeGenerousFirstMoves ?? false;
	const sampleFirstMoves =
		options.sampleFirstMoves ?? (size >= 4 ? 8 : undefined);
	const countShortestPaths = size <= 3;

	const generousFirstMoveCount = includeGenerousFirstMoves
		? countGenerousFirstMoves(config, minMoves, moves, maxDepth, sampleFirstMoves)
				.generousFirstMoveCount
		: 0;

	const shortestSolutionCount =
		options.shortestSolutionCountOverride ??
		(countShortestPaths ? countSolutionPaths(config, minMoves, moves, cap) : 1);
	// The override is an exact algebraic count, not DFS-capped — only the DFS path counts.
	const cappedAfterShortest =
		options.shortestSolutionCountOverride === undefined &&
		countShortestPaths &&
		shortestSolutionCount >= cap;
	const nearOptimalSolutionCount =
		!includeNearOptimal || cappedAfterShortest
			? 0
			: countSolutionPaths(config, minMoves + 1, moves, cap - shortestSolutionCount);
	const touch = countSolutionCellApplications(solution, config.templates);

	return {
		hammingWeight: hammingWeight(config),
		generousFirstMoveCount,
		totalFirstMoves,
		generousFirstMoveRate:
			totalFirstMoves > 0 ? generousFirstMoveCount / totalFirstMoves : 0,
		shortestSolutionCount,
		nearOptimalSolutionCount,
		solutionCountCapped: cappedAfterShortest || shortestSolutionCount + nearOptimalSolutionCount >= cap,
		cellsTouchedBySolution: touch.cellsTouchedBySolution,
		cellsTouchedOnce: touch.cellsTouchedOnce,
		cellsTouchedMultiple: touch.cellsTouchedMultiple,
		maxApplicationsPerCell: touch.maxApplicationsPerCell,
		overlapDensity: touch.overlapDensity
	};
}

/**
 * Structural difficulty — move count, solution overlap, and board coverage.
 * Higher means harder.
 */
export function structuralDifficultyScore(
	minMoves: number,
	forgiveness: ForgivenessMetrics,
	_rotationQuarterTurns: number,
	_colorChanges: number
): number {
	return (
		minMoves * 25 +
		forgiveness.cellsTouchedBySolution * 12 +
		forgiveness.cellsTouchedMultiple * 20 +
		forgiveness.maxApplicationsPerCell * 10 +
		forgiveness.overlapDensity * 35 +
		forgiveness.hammingWeight * 2
	);
}

/**
 * Forgiveness ease — inverted forgiveness signals (higher = easier).
 */
export function forgivenessEaseScore(forgiveness: ForgivenessMetrics): number {
	const forgivenessDiscount =
		forgiveness.nearOptimalSolutionCount > 0
			? Math.log(Math.max(1, forgiveness.nearOptimalSolutionCount)) * 6
			: forgiveness.generousFirstMoveRate * 12;

	return (
		forgivenessDiscount +
		Math.log(Math.max(1, forgiveness.shortestSolutionCount)) * 2 +
		Math.log(Math.max(1, forgiveness.totalFirstMoves)) * 3
	);
}

/**
 * Mechanics difficulty — rotation/color coupling and stencil complexity.
 * Higher means harder.
 */
export function mechanicsDifficultyScore(
	rotationQuarterTurns: number,
	colorChanges: number,
	distinctPigments: number,
	templateCount: number
): number {
	return (
		rotationQuarterTurns * 4 +
		colorChanges * 4 +
		Math.max(0, distinctPigments - 1) * 3 +
		Math.max(0, templateCount - 2) * 2
	);
}

/** Mono-puzzle defaults keep `compositeDifficultyScore` backward compatible. */
const COMPOSITE_MECHANICS_PIGMENTS = 1;
const COMPOSITE_MECHANICS_TEMPLATE_COUNT = 2;

/**
 * Composite difficulty — higher means harder.
 *
 * Sum of structural + mechanics (mono baseline) − forgiveness ease.
 */
export function compositeDifficultyScore(
	minMoves: number,
	forgiveness: ForgivenessMetrics,
	rotationQuarterTurns: number,
	colorChanges: number
): number {
	return (
		structuralDifficultyScore(minMoves, forgiveness, rotationQuarterTurns, colorChanges) +
		mechanicsDifficultyScore(
			rotationQuarterTurns,
			colorChanges,
			COMPOSITE_MECHANICS_PIGMENTS,
			COMPOSITE_MECHANICS_TEMPLATE_COUNT
		) -
		forgivenessEaseScore(forgiveness)
	);
}
