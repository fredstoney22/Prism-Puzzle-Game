import { describe, it, expect } from 'vitest';
import { AlgebraicDifficultyEvaluator, algebraicDifficultyEvaluator } from './algebraicDifficultyEvaluator.js';
import { bfsDifficultyEvaluator } from './generationServices.js';
import { evaluatePuzzleDifficulty } from '../puzzleDifficulty.js';
import { solvePuzzleAlgebraically } from '../puzzleAlgebraicSolver.js';
import { generateVerifiedPuzzle } from '../PuzzleGenerator.js';
import { applyTemplate, isSolved } from '../PuzzleFunctions.js';
import { orientTemplate } from '../templatePigment.js';
import { PIGMENT_CLEAR_SOLVED_VALUE } from '../types.js';
import type { PuzzleConfig, PuzzleGrid } from '../types.js';
import { packs } from '../packs.js';

function applySolution(config: PuzzleConfig): PuzzleGrid {
	const report = algebraicDifficultyEvaluator.evaluate(config, 20, { profile: 'fast' });
	let state = config.startState.map((row) => [...row]);
	for (const move of report!.solution) {
		const template = orientTemplate(config.templates[move.templateIndex], move.rotation);
		state = applyTemplate(state, template, move.row, move.col);
	}
	return state;
}

describe('AlgebraicDifficultyEvaluator', () => {
	it('matches BFS minMoves exactly across the multicolor pack (guaranteed regardless of tie-breaking)', () => {
		const pack = packs.find((p) => p.slug === 'multicolor');
		expect(pack).toBeDefined();

		for (const [puzzleId, config] of Object.entries(pack!.puzzles)) {
			const algebraic = algebraicDifficultyEvaluator.evaluate(config, 20, { profile: 'fast' });
			const bfs = evaluatePuzzleDifficulty(config, 20, { profile: 'fast' });

			expect(algebraic, `puzzle ${puzzleId}`).not.toBeNull();
			expect(bfs, `puzzle ${puzzleId}`).not.toBeNull();

			// minMoves is a scalar (the minimum weight) — guaranteed to match
			// regardless of which tied-minimal move set either solver picks.
			expect(algebraic!.minMoves, `puzzle ${puzzleId} minMoves`).toBe(bfs!.minMoves);
			expect(algebraic!.solution.length, `puzzle ${puzzleId} solution length`).toBe(bfs!.minMoves);
		}
	});

	it('matches BFS on move-set-derived fields when the solution is unique (nullity 0)', () => {
		const pack = packs.find((p) => p.slug === 'multicolor');

		for (const [puzzleId, config] of Object.entries(pack!.puzzles)) {
			const algebraic = solvePuzzleAlgebraically(config);
			if (!algebraic || algebraic.nullity !== 0) continue;

			const bfs = evaluatePuzzleDifficulty(config, 20, { profile: 'fast' })!;
			const report = algebraicDifficultyEvaluator.evaluate(config, 20, { profile: 'fast' })!;

			// With a unique minimal solution there's no tie to break differently —
			// both solvers must land on the same move set, so everything derived
			// from it matches exactly, not just minMoves.
			expect(report.solutionGridCellsCovered, `puzzle ${puzzleId} coverage`).toBe(
				bfs.solutionGridCellsCovered
			);
			expect(report.rotationQuarterTurns, `puzzle ${puzzleId} rotationQuarterTurns`).toBe(
				bfs.rotationQuarterTurns
			);
		}
	});

	it('returns a solution that actually clears the puzzle (applied move by move)', () => {
		const pack = packs.find((p) => p.slug === 'multicolor');
		for (const [puzzleId, config] of Object.entries(pack!.puzzles).slice(0, 15)) {
			const finalState = applySolution(config);
			expect(isSolved(finalState, config.solvedValue), `puzzle ${puzzleId}`).toBe(true);
		}
	});

	it('falls back to BFS when nullity exceeds the brute-force cap', () => {
		const colorSpectrum = packs.find((p) => p.slug === 'color-spectrum');
		expect(colorSpectrum).toBeDefined();
		// Puzzle 9 has nullity 22 (see report-pack-nullity.ts output) — above the default cap.
		const config = colorSpectrum!.puzzles[9];

		// solvePuzzleAlgebraically returning null (not the report itself) is the
		// actual fallback trigger being tested — avoids paying for BFS twice.
		expect(solvePuzzleAlgebraically(config)).toBeNull();

		const algebraic = algebraicDifficultyEvaluator.evaluate(config, 20, { profile: 'fast' });
		expect(algebraic).not.toBeNull();
		expect(algebraic!.minMoves).toBeGreaterThan(0);
	}, 15000);

	it('delegates entirely to the fallback when MUSE is requested', () => {
		let fallbackCalled = false;
		const spyFallback = {
			evaluate: (config: PuzzleConfig, maxDepth?: number, options?: unknown) => {
				fallbackCalled = true;
				return bfsDifficultyEvaluator.evaluate(config, maxDepth, options as never);
			}
		};
		const evaluator = new AlgebraicDifficultyEvaluator(spyFallback);

		const config: PuzzleConfig = {
			startState: [[1, 0], [0, 0]],
			templates: [{ shape: [[1, 0], [0, 0]] }],
			solvedValue: 0
		};

		evaluator.evaluate(config, 12, { profile: 'full' });
		expect(fallbackCalled).toBe(true);
	});

	it('agrees with BFS minMoves on freshly reverse-generated puzzles', () => {
		for (let i = 0; i < 15; i++) {
			const generated = generateVerifiedPuzzle({
				puzzleSize: 3,
				targetMinMoves: 3,
				solvedValue: PIGMENT_CLEAR_SOLVED_VALUE,
				allowedPigments: [1, 2, 4],
				templateCount: 3,
				minMultiColoredTemplates: 1,
				minTemplatesPerPigment: 1
			});

			const algebraic = algebraicDifficultyEvaluator.evaluate(generated, 12, { profile: 'fast' });
			const bfs = evaluatePuzzleDifficulty(generated, 12, { profile: 'fast' });

			expect(algebraic).not.toBeNull();
			expect(algebraic!.minMoves).toBe(bfs!.minMoves);
		}
	});
});
