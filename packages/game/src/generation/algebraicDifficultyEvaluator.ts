/**
 * Injectable DifficultyEvaluator — algebraic (GF(2)) solve + direct metric
 * computation from the reconstructed solution, falling back to the BFS-based
 * evaluatePuzzleDifficulty when the algebraic solve can't produce an answer.
 *
 * evaluatePuzzleDifficulty (puzzleDifficulty.ts) does three separate BFS passes
 * per call: build a full search session for the shortest path, then two more
 * solveMinMoves calls (with/without rotation) just to derive `requiresRotation`.
 * This evaluator replaces all three with one algebraic solve (for minMoves +
 * solution) plus a second, cheap algebraic solve with rotations disabled (for
 * requiresRotation) — see puzzleAlgebraicSolver.ts.
 *
 * MUSE requires walking the actual state graph (branching factor at each
 * intermediate state), which doesn't reduce to linear algebra — when it's
 * requested (`full` profile only, never the pool-generation hot path), this
 * delegates the whole evaluation to BFS rather than half-optimize a rare path.
 *
 * Caveat: `minMoves` always matches BFS exactly — the minimum weight is a
 * well-defined scalar regardless of which solver finds it. But when nullity > 0
 * there can be multiple distinct move SETS tied for that same minimum weight
 * (that's what a nonzero nullity means — see puzzleSolvability.ts's "quiet
 * patterns"). BFS's path reconstruction and this solver's kernel scan break
 * ties independently and can land on different-but-equally-valid minimal move
 * sets. Everything derived from *which specific moves* were chosen —
 * solutionGridCellsCovered, meetsMinGridCoverage, colorChanges,
 * rotationQuarterTurns, and the pillars/compositeDifficulty built from them —
 * can differ from BFS's choice in that case, even though both are correct,
 * genuinely-minimal solutions. Only exact when nullity is 0 (unique solution)
 * or the two solvers happen to pick the same tie-break. See
 * algebraicDifficultyEvaluator.test.ts for what's actually guaranteed to match.
 */
import { solvePuzzleAlgebraically } from '../puzzleAlgebraicSolver.js';
import {
	countColorChanges,
	countRotationMetrics,
	evaluatePuzzleDifficulty,
	type DifficultyReport
} from '../puzzleDifficulty.js';
import {
	compositeDifficultyScore,
	evaluateForgivenessMetrics,
	forgivenessEaseScore,
	mechanicsDifficultyScore,
	structuralDifficultyScore,
	type ForgivenessMetrics
} from '../puzzleForgiveness.js';
import { distinctPigmentsInPuzzle } from '../pigmentTemplates.js';
import {
	countSolutionGridCoverage,
	meetsMinSolutionGridCoverage,
	minSolutionGridCellsRequired
} from '../solutionGridCoverage.js';
import { resolveSearchBudget } from '../searchBudget.js';
import { resolveDifficultyOptions } from './difficultyProfiles.js';
import type { PuzzleConfig } from '../types.js';
import type { DifficultyEvaluationOptions, DifficultyEvaluator } from './generationServices.js';

// Constructs the fallback directly on evaluatePuzzleDifficulty (not
// generationServices.ts's defaultDifficultyEvaluator) to avoid a circular
// import — generationServices.ts imports this module's default export.
const bfsFallback: DifficultyEvaluator = {
	evaluate: (config, maxDepth, options) => evaluatePuzzleDifficulty(config, maxDepth, options)
};

function zeroForgiveness(config: PuzzleConfig): ForgivenessMetrics {
	return {
		hammingWeight: config.startState.flat().filter((cell) => cell !== config.solvedValue).length,
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
}

export class AlgebraicDifficultyEvaluator implements DifficultyEvaluator {
	constructor(private readonly fallback: DifficultyEvaluator = bfsFallback) {}

	evaluate(
		config: PuzzleConfig,
		maxDepth?: number,
		options: DifficultyEvaluationOptions = {}
	): DifficultyReport | null {
		const { profile, maxStatesVisited, ...overrides } = options;
		const resolved = resolveDifficultyOptions(profile ?? 'standard', overrides);

		// MUSE needs an actual graph walk (branching factor per intermediate
		// state) — not derivable from the linear system. Rare path; not worth a
		// partial-algebraic special case.
		if (resolved.includeMuse) {
			return this.fallback.evaluate(config, maxDepth, options);
		}

		const depth = maxDepth ?? resolveSearchBudget(config, 'authoring').maxDepth;
		const algebraic = solvePuzzleAlgebraically(config, { includeRotations: true });
		if (!algebraic || algebraic.minMoves > depth) {
			return this.fallback.evaluate(config, maxDepth, options);
		}

		const { minMoves, solution, minimalSolutionCount } = algebraic;

		// Mirrors evaluatePuzzleDifficulty's original `withRotation !== null &&
		// withoutRotation === null` check — withRotation is redundant once we
		// already have a with-rotation solution above, so this just checks the
		// without-rotation case directly.
		const withoutRotation = solvePuzzleAlgebraically(config, { includeRotations: false });
		const requiresRotation = withoutRotation === null;

		const rotationMetrics = countRotationMetrics(solution);
		const rotationQuarterTurns = rotationMetrics.rotationQuarterTurns;
		const gridSize = config.startState.length;
		const colorChanges = countColorChanges(solution, config.templates);
		const distinctPigmentsInTemplates = distinctPigmentsInPuzzle(config.templates).length;
		const templateCount = config.templates.length;

		// The exhaustive DFS behind shortestSolutionCount was the actual dominant
		// cost in real pack generation (measured: ~1.8s on one puzzle, tens of
		// seconds across a candidate shortlist) — it's unconditional whenever
		// forgiveness is on at all, unlike the other two (correctly-gated)
		// expensive forgiveness pieces. Skip it here in favor of the free
		// minimalSolutionCount already computed above, reserving the exact DFS
		// count for when near-optimal paths are also requested (full profile,
		// which this evaluator doesn't reach anyway — see the includeMuse guard).
		const forgiveness = resolved.includeForgiveness
			? evaluateForgivenessMetrics(config, minMoves, solution, {
					maxDepth: depth,
					includeNearOptimalPaths: resolved.includeNearOptimalPaths,
					includeGenerousFirstMoves: resolved.includeGenerousFirstMoves,
					shortestSolutionCountOverride: resolved.includeNearOptimalPaths
						? undefined
						: minimalSolutionCount
				})
			: zeroForgiveness(config);

		const pillars = {
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

		return {
			minMoves,
			solution,
			colorChanges,
			rotationsRequired: rotationMetrics.rotationsRequired,
			rotationQuarterTurns,
			requiresRotation,
			distinctPigmentsInTemplates,
			templateCount,
			solutionGridCellsCovered: countSolutionGridCoverage(solution, config.templates),
			minSolutionGridCellsRequired: minSolutionGridCellsRequired(gridSize),
			meetsMinGridCoverage: meetsMinSolutionGridCoverage(solution, config.templates, gridSize),
			forgiveness,
			compositeDifficulty: compositeDifficultyScore(
				minMoves,
				forgiveness,
				rotationQuarterTurns,
				colorChanges
			),
			pillars
		};
	}
}

/** Default algebraic-first difficulty evaluator, falling back to BFS. */
export const algebraicDifficultyEvaluator: DifficultyEvaluator = new AlgebraicDifficultyEvaluator();
