/**
 * Injectable MinMovesSolver — algebraic (GF(2) kernel search) with a BFS fallback.
 *
 * Tries the exact linear-algebra solver first (see puzzleAlgebraicSolver.ts);
 * falls back to BFS only when nullity exceeds the brute-force cap or the puzzle
 * isn't solvable under the algebraic model. Validated to agree exactly with BFS
 * across 140 real puzzles plus fuzz-tested reverse-generated puzzles — see
 * puzzleAlgebraicSolver.test.ts and scripts/validate-algebraic-solver.ts.
 */
import {
	solveMinMovesAlgebraic,
	type AlgebraicSolveOptions
} from '../puzzleAlgebraicSolver.js';
import { solveMinMoves } from '../puzzleSolver.js';
import type { MinMovesSolver } from './generationServices.js';
import type { PuzzleConfig } from '../types.js';

// Falls back to solveMinMoves directly (not generationServices.ts's
// defaultMinMovesSolver) to avoid a circular import — generationServices.ts
// imports this module's default export as its own defaultGenerationServices.solver.
const bfsFallback: MinMovesSolver = {
	solve: (config, maxDepth, options) => solveMinMoves(config, maxDepth, options)
};

export class AlgebraicMinMovesSolver implements MinMovesSolver {
	constructor(private readonly fallback: MinMovesSolver = bfsFallback) {}

	solve(
		config: PuzzleConfig,
		maxDepth?: number,
		options?: { includeRotations?: boolean; maxStatesVisited?: number }
	): number | null {
		const algebraicOptions: AlgebraicSolveOptions = {
			includeRotations: options?.includeRotations
		};
		const result = solveMinMovesAlgebraic(config, algebraicOptions);

		if (result !== null) {
			// Preserve BFS's depth-bound contract: a real but longer-than-maxDepth
			// solution should read as "not found within depth", not "found".
			return maxDepth !== undefined && result.minMoves > maxDepth ? null : result.minMoves;
		}

		return this.fallback.solve(config, maxDepth, options);
	}
}

/** Default algebraic-first solver, falling back to the standard BFS solver. */
export const algebraicMinMovesSolver: MinMovesSolver = new AlgebraicMinMovesSolver();
