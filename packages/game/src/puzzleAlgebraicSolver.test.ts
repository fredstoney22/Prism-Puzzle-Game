import { describe, it, expect } from 'vitest';
import { solveMinMovesAlgebraic } from './puzzleAlgebraicSolver.js';
import { analyzeSolvability } from './puzzleSolvability.js';
import { solveMinMoves } from './puzzleSolver.js';
import { generateVerifiedPuzzle } from './PuzzleGenerator.js';
import { PIGMENT_CLEAR_SOLVED_VALUE } from './types.js';
import type { PuzzleConfig } from './types.js';
import { packs } from './packs.js';

describe('solveMinMovesAlgebraic', () => {
	it('returns 0 moves for an already-solved puzzle', () => {
		const config: PuzzleConfig = {
			startState: [
				[0, 0, 0],
				[0, 0, 0],
				[0, 0, 0]
			],
			templates: [{ shape: [[1, 1], [1, 0]] }],
			solvedValue: 0
		};

		const result = solveMinMovesAlgebraic(config);
		expect(result).not.toBeNull();
		expect(result!.minMoves).toBe(0);
	});

	it('returns null when there are no placements and the puzzle is unsolved', () => {
		const config: PuzzleConfig = { startState: [[1]], templates: [], solvedValue: 0 };
		expect(solveMinMovesAlgebraic(config)).toBeNull();
	});

	it('finds the unique 1-move solution for a full-rank single-placement puzzle', () => {
		const config: PuzzleConfig = {
			startState: [[1]],
			templates: [{ shape: [[1]] }],
			solvedValue: 0
		};

		const result = solveMinMovesAlgebraic(config);
		expect(result).toEqual({ minMoves: 1, nullity: 0 });
	});

	it('picks the minimum-weight solution over a nonzero kernel (research example)', () => {
		// 3x3 mono, 2x2 block + 3x1 line lenses: nullity 1 per the research doc's
		// worked example (rank 9, placement count 10, one quiet pattern).
		const config: PuzzleConfig = {
			startState: [
				[1, 0, 0],
				[0, 0, 0],
				[0, 0, 0]
			],
			templates: [{ shape: [[1, 1], [1, 1]] }, { shape: [[1, 1, 1]] }],
			solvedValue: 0
		};

		const algebraic = solveMinMovesAlgebraic(config);
		const bfs = solveMinMoves(config, 12);

		expect(algebraic).not.toBeNull();
		expect(algebraic!.minMoves).toBe(bfs);
	});

	it('reports the same nullity as analyzeSolvability', () => {
		// Start state is the template applied once to a solved 2x2 grid, so it's
		// guaranteed reachable (unlike an arbitrary RYB pattern, which may not be
		// in the column space of a single-template move set at all).
		const config: PuzzleConfig = {
			startState: [
				[1, 2],
				[0, 0]
			],
			templates: [{ shape: [[1, 2], [0, 0]] }],
			solvedValue: 0
		};

		const algebraic = solveMinMovesAlgebraic(config);
		const report = analyzeSolvability(config);
		expect(report.isStartSolvable).toBe(true);
		expect(algebraic).not.toBeNull();
		expect(algebraic!.nullity).toBe(report.nullity);
	});

	it('agrees exactly with BFS across the first-steps pack', () => {
		const firstSteps = packs.find((pack) => pack.slug === 'first-steps');
		expect(firstSteps).toBeDefined();

		for (const [puzzleId, config] of Object.entries(firstSteps!.puzzles)) {
			const algebraic = solveMinMovesAlgebraic(config);
			const bfs = solveMinMoves(config, 20);

			if (algebraic !== null) {
				expect(algebraic.minMoves, `puzzle ${puzzleId}`).toBe(bfs);
			} else {
				// algebraic solver only returns null for "unsolvable" or "nullity too
				// large" — first-steps puzzles are all small and solvable, so bfs
				// should agree the puzzle is solvable even if we skipped it here.
				expect(bfs, `puzzle ${puzzleId} should still be BFS-solvable`).not.toBeNull();
			}
		}
	});

	it('agrees exactly with BFS on freshly reverse-generated puzzles', () => {
		for (let i = 0; i < 20; i++) {
			const generated = generateVerifiedPuzzle({
				puzzleSize: 3,
				targetMinMoves: 3,
				solvedValue: PIGMENT_CLEAR_SOLVED_VALUE,
				allowedPigments: [1, 2, 4],
				templateCount: 3,
				minMultiColoredTemplates: 1,
				minTemplatesPerPigment: 1
			});

			const algebraic = solveMinMovesAlgebraic(generated);
			const bfs = solveMinMoves(generated, 12);

			expect(algebraic).not.toBeNull();
			expect(algebraic!.minMoves).toBe(bfs);
		}
	});
});
