/**
 * Injectable services for puzzle generation and difficulty analysis.
 */

import { evaluatePuzzleDifficulty, type DifficultyReport } from '../puzzleDifficulty.js';
import { solveMinMoves } from '../puzzleSolver.js';
import type { PuzzleConfig } from '../types.js';
import { compositeScrambleDifficultyScore } from './candidateScoring.js';
import {
	resolveDifficultyOptions,
	type DifficultyEvaluationProfile
} from './difficultyProfiles.js';
import type { PedagogyValidator } from './pedagogyValidator.js';
import type { SolvabilityAnalyzer } from './solvabilityAnalyzer.js';
import type { MuseAnalyzer } from './museAnalyzer.js';
import { algebraicMinMovesSolver } from './algebraicMinMovesSolver.js';
import { algebraicDifficultyEvaluator } from './algebraicDifficultyEvaluator.js';

export { AlgebraicMinMovesSolver, algebraicMinMovesSolver } from './algebraicMinMovesSolver.js';
export {
	AlgebraicDifficultyEvaluator,
	algebraicDifficultyEvaluator
} from './algebraicDifficultyEvaluator.js';

export type { DifficultyEvaluationProfile };

/**
 * Options for difficulty evaluation during generation.
 *
 * Prefer `profile` over raw flags — profiles encode generation-stage policy:
 * - `fast`: minMoves + solution path only (no forgiveness, no MUSE)
 * - `standard`: forgiveness on, no MUSE (default)
 * - `full`: forgiveness + MUSE (offline / research)
 */
export interface DifficultyEvaluationOptions {
	profile?: DifficultyEvaluationProfile;
	includeForgiveness?: boolean;
	includeMuse?: boolean;
	includeNearOptimalPaths?: boolean;
	includeGenerousFirstMoves?: boolean;
	/** Abort (treat as unsolvable) once BFS visited-state count exceeds this. Default: unbounded. */
	maxStatesVisited?: number;
}

export interface DifficultyEvaluator {
	evaluate(
		config: PuzzleConfig,
		maxDepth?: number,
		options?: DifficultyEvaluationOptions
	): DifficultyReport | null;
}

export interface MinMovesSolver {
	solve(
		config: PuzzleConfig,
		maxDepth?: number,
		options?: { includeRotations?: boolean; maxStatesVisited?: number }
	): number | null;
}

export interface CandidateScoreInput {
	report: DifficultyReport;
	scrambleLength: number;
	rotationReuseCount: number;
}

export interface CandidateScorer {
	score(input: CandidateScoreInput): number;
}

/** Bundle passed through generation strategies (swap implementations for tests or new policies). */
export interface GenerationServices {
	difficulty: DifficultyEvaluator;
	solver: MinMovesSolver;
	candidateScorer: CandidateScorer;
	/** Optional GF(2) solvability strategy — not used by default generation. */
	solvability?: SolvabilityAnalyzer;
	/** Optional MUSE entropy strategy — not used by default generation. */
	muse?: MuseAnalyzer;
	/** Optional pedagogy concept validator — not used by default generation. */
	pedagogy?: PedagogyValidator;
}

export const defaultDifficultyEvaluator: DifficultyEvaluator = {
	evaluate: (config, maxDepth, options) => {
		const resolved = resolveDifficultyOptions(options?.profile ?? 'standard', {
			includeForgiveness: options?.includeForgiveness,
			includeMuse: options?.includeMuse,
			includeNearOptimalPaths: options?.includeNearOptimalPaths,
			includeGenerousFirstMoves: options?.includeGenerousFirstMoves
		});
		return evaluatePuzzleDifficulty(config, maxDepth, {
			...resolved,
			maxStatesVisited: options?.maxStatesVisited
		});
	}
};

/** Plain BFS solver — no longer the default (see {@link algebraicMinMovesSolver}), kept for explicit opt-in / comparison. */
export const defaultMinMovesSolver: MinMovesSolver = {
	solve: (config, maxDepth, options) => solveMinMoves(config, maxDepth, options)
};

export const compositeCandidateScorer: CandidateScorer = {
	score: compositeScrambleDifficultyScore
};

/** Plain BFS evaluator — no longer the default (see {@link algebraicDifficultyEvaluator}), kept for explicit opt-in / comparison. */
export { defaultDifficultyEvaluator as bfsDifficultyEvaluator };

export const defaultGenerationServices: GenerationServices = {
	difficulty: algebraicDifficultyEvaluator,
	solver: algebraicMinMovesSolver,
	candidateScorer: compositeCandidateScorer
};

export {
	composableDifficultyEvaluator,
	defaultDifficultyMetrics,
	ComposableDifficultyEvaluator
} from './composableDifficultyEvaluator.js';
