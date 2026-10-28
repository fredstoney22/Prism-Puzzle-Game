/**
 * Post-generation puzzle difficulty metrics from a shortest intended solution.
 */

import { solveMinMoves } from './puzzleSolver.js';
import { distinctPigmentsInPuzzle } from './pigmentTemplates.js';
import { distinctPigmentsInTemplate, orientTemplate } from './templatePigment.js';
import { buildPuzzleSearchSession, getShortestPath, getMinMoves } from './puzzleSearchSession.js';
import {
	countSolutionGridCoverage,
	meetsMinSolutionGridCoverage,
	minSolutionGridCellsRequired
} from './solutionGridCoverage.js';
import {
	compositeDifficultyScore,
	evaluateForgivenessMetrics,
	forgivenessEaseScore,
	mechanicsDifficultyScore,
	structuralDifficultyScore,
	type ForgivenessMetrics
} from './puzzleForgiveness.js';
import type { PuzzleConfig, PuzzleTemplate } from './types.js';
import { computeMuse } from './puzzleEntropy.js';
import type { ResolvedDifficultyOptions } from './generation/difficultyProfiles.js';
import {
	resolveDifficultyOptions,
	type DifficultyEvaluationProfile
} from './generation/difficultyProfiles.js';
import { resolveSearchBudget } from './searchBudget.js';

export type { DifficultyEvaluationProfile, ResolvedDifficultyOptions };

export interface SolutionMove {
	templateIndex: number;
	/** Clockwise quarter turns from the stencil's default orientation. */
	rotation: number;
	row: number;
	col: number;
}

export interface DifficultyPillars {
	/** Move count, overlap, and coverage on the shortest path. */
	structural: number;
	/** Inverted forgiveness — higher means easier. */
	forgivenessEase: number;
	/** Rotation, color coupling, and stencil complexity. */
	mechanics: number;
	/** MUSE cognitive friction when computed. */
	cognitive?: number;
}

export interface DifficultyReport {
	/** Shortest move count to clear the grid. */
	minMoves: number;
	/** One shortest solution path (player moves). */
	solution: SolutionMove[];
	/**
	 * Times consecutive moves apply a different pigment set.
	 * Mono puzzles are always 0; color puzzles count pigment-set transitions.
	 */
	colorChanges: number;
	/** Moves in the solution where rotation > 0. */
	rotationsRequired: number;
	/** Sum of quarter-turn rotations across the solution. */
	rotationQuarterTurns: number;
	/** No solution exists when stencil rotation is disabled. */
	requiresRotation: boolean;
	distinctPigmentsInTemplates: number;
	templateCount: number;
	/** Distinct grid cells touched across the shortest solution. */
	solutionGridCellsCovered: number;
	/** Minimum grid cells required for sufficient complexity (two thirds of the board). */
	minSolutionGridCellsRequired: number;
	/** False when the shortest solution touches too few grid cells. */
	meetsMinGridCoverage: boolean;
	/** Redundancy / forgiveness signals (high = feels easier). */
	forgiveness: ForgivenessMetrics;
	/** Higher = harder; blends move count with forgiveness. */
	compositeDifficulty: number;
	/** Per-pillar subscores for authoring and tuning. */
	pillars?: DifficultyPillars;
	/** MUSE (minimum uniform solution entropy) in bits; null when not computed. */
	muse?: number;
	/** Simplified path entropy sum from the research doc; null when not computed. */
	pathUniformEntropy?: number;
	/** Branching counts |σ(s)| along one shortest path; empty when not computed. */
	pathBranchingCounts?: number[];
}

function pigmentSignature(template: PuzzleTemplate): string {
	return distinctPigmentsInTemplate(template).join(',');
}

export function countColorChanges(solution: SolutionMove[], templates: PuzzleTemplate[]): number {
	if (solution.length <= 1) return 0;

	let changes = 0;
	for (let i = 1; i < solution.length; i++) {
		const prev = orientTemplate(templates[solution[i - 1].templateIndex], solution[i - 1].rotation);
		const curr = orientTemplate(templates[solution[i].templateIndex], solution[i].rotation);
		if (pigmentSignature(prev) !== pigmentSignature(curr)) {
			changes++;
		}
	}
	return changes;
}

export function countRotationMetrics(solution: SolutionMove[]): {
	rotationsRequired: number;
	rotationQuarterTurns: number;
} {
	let rotationsRequired = 0;
	let rotationQuarterTurns = 0;
	for (const move of solution) {
		if (move.rotation > 0) {
			rotationsRequired++;
			rotationQuarterTurns += move.rotation;
		}
	}
	return { rotationsRequired, rotationQuarterTurns };
}

const DEFAULT_MAX_DEPTH = 12;

/**
 * Finds one shortest solution that clears the grid (matches player win rules).
 * Default depth is 12; use {@link resolveSearchBudget} at call sites that need grid-aware limits.
 */
export function findShortestSolution(
	config: PuzzleConfig,
	maxDepth: number = DEFAULT_MAX_DEPTH,
	options: { includeRotations?: boolean } = {}
): SolutionMove[] | null {
	const session = buildPuzzleSearchSession(config, {
		maxDepth,
		includeRotations: options.includeRotations
	});
	return session ? getShortestPath(session) : null;
}

/** True when a shortest solution exists and uses every template index at least once. */
export function shortestSolutionUsesAllTemplates(
	config: PuzzleConfig,
	maxDepth: number = DEFAULT_MAX_DEPTH,
	options: { includeRotations?: boolean } = {}
): boolean {
	const solution = findShortestSolution(config, maxDepth, options);
	if (!solution) return false;
	const used = new Set(solution.map((move) => move.templateIndex));
	return used.size === config.templates.length;
}

export function evaluatePuzzleDifficulty(
	config: PuzzleConfig,
	maxDepth?: number,
	options: Partial<ResolvedDifficultyOptions> & {
		profile?: DifficultyEvaluationProfile;
		maxStatesVisited?: number;
	} = {}
): DifficultyReport | null {
	const { profile, maxStatesVisited, ...overrides } = options;
	const { includeForgiveness, includeMuse, includeNearOptimalPaths, includeGenerousFirstMoves } =
		resolveDifficultyOptions(profile ?? 'standard', overrides);
	const depth = maxDepth ?? resolveSearchBudget(config, 'authoring').maxDepth;
	const session = buildPuzzleSearchSession(config, { maxDepth: depth, maxStatesVisited });
	if (!session) return null;

	const solution = getShortestPath(session);
	if (!solution) return null;

	const minMoves = getMinMoves(session);
	if (minMoves === null) return null;

	const rotationMetrics = countRotationMetrics(solution);
	const withRotation = solveMinMoves(config, depth, { includeRotations: true, maxStatesVisited });
	const withoutRotation = solveMinMoves(config, depth, {
		includeRotations: false,
		maxStatesVisited
	});
	const gridSize = config.startState.length;
	const solutionGridCellsCovered = countSolutionGridCoverage(solution, config.templates);
	const minGridCellsRequired = minSolutionGridCellsRequired(gridSize);
	const colorChanges = countColorChanges(solution, config.templates);
	const distinctPigmentsInTemplates = distinctPigmentsInPuzzle(config.templates).length;
	const templateCount = config.templates.length;
	const forgiveness = includeForgiveness
		? evaluateForgivenessMetrics(config, minMoves, solution, {
				maxDepth: depth,
				includeNearOptimalPaths,
				includeGenerousFirstMoves
			})
		: {
				hammingWeight: config.startState.flat().filter((cell) => cell !== config.solvedValue)
					.length,
				generousFirstMoveCount: 0,
				totalFirstMoves: 0,
				generousFirstMoveRate: 0,
				shortestSolutionCount: 1,
				nearOptimalSolutionCount: 0,
				solutionCountCapped: false,
				cellsTouchedBySolution: 0,
				cellsTouchedOnce: 0,
				cellsTouchedMultiple: 0,
				maxApplicationsPerCell: 0,
				overlapDensity: 0
			};

	const rotationQuarterTurns = rotationMetrics.rotationQuarterTurns;
	const pillars: DifficultyPillars = {
		structural: structuralDifficultyScore(
			minMoves,
			forgiveness,
			rotationQuarterTurns,
			colorChanges
		),
		forgivenessEase: forgivenessEaseScore(forgiveness),
		mechanics: mechanicsDifficultyScore(
			rotationQuarterTurns,
			colorChanges,
			distinctPigmentsInTemplates,
			templateCount
		)
	};

	const museExtras = includeMuse
		? (() => {
				const museReport = computeMuse(config, { maxDepth: depth, actionPolicy: 'shortest-path' });
				if (!museReport) return {};
				pillars.cognitive = museReport.muse;
				return {
					muse: museReport.muse,
					pathUniformEntropy: museReport.pathUniformEntropy,
					pathBranchingCounts: museReport.pathBranchingCounts
				};
			})()
		: {};

	return {
		minMoves,
		solution,
		colorChanges,
		rotationsRequired: rotationMetrics.rotationsRequired,
		rotationQuarterTurns,
		requiresRotation: withRotation !== null && withoutRotation === null,
		distinctPigmentsInTemplates,
		templateCount,
		solutionGridCellsCovered,
		minSolutionGridCellsRequired: minGridCellsRequired,
		meetsMinGridCoverage: meetsMinSolutionGridCoverage(solution, config.templates, gridSize),
		forgiveness,
		compositeDifficulty: compositeDifficultyScore(
			minMoves,
			forgiveness,
			rotationQuarterTurns,
			colorChanges
		),
		pillars,
		...museExtras
	};
}
