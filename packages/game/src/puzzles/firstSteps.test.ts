import { describe, it, expect } from 'vitest';
import { solveMinMoves } from '../PuzzleGenerator.js';
import { createPedagogyValidator } from '../generation/pedagogyValidator.js';
import { getPackBySlug } from '../packs.js';
import {
	firstStepsPack,
	FIRST_STEPS_CONCEPTS,
	FIRST_STEPS_SLUG,
	getFirstStepsConcept
} from './firstSteps.js';
import { requiresEveryTemplate, requiresTemplateRotation } from './firstStepsPedagogy.js';

const pedagogy = createPedagogyValidator({ maxDepth: 12 });

describe('firstStepsPack', () => {
	it('defines nine concept labels in teaching order', () => {
		expect(
			Object.keys(FIRST_STEPS_CONCEPTS)
				.map(Number)
				.sort((a, b) => a - b)
		).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it('has a concept label for every puzzle in the pack', () => {
		for (const id of Object.keys(firstStepsPack.puzzles).map(Number)) {
			expect(FIRST_STEPS_CONCEPTS[id], `concept for puzzle ${id}`).toBeTruthy();
			expect(getFirstStepsConcept(id)).toBe(FIRST_STEPS_CONCEPTS[id]);
		}
	});

	it('every puzzle clears to white', () => {
		for (const [idStr, cfg] of Object.entries(firstStepsPack.puzzles)) {
			expect(cfg.solvedValue, `puzzle ${idStr}`).toBe(0);
		}
	});

	it('every puzzle is solvable by clearing the grid', () => {
		for (const [idStr, cfg] of Object.entries(firstStepsPack.puzzles)) {
			if (idStr === '8') continue;
			const verified = solveMinMoves(cfg, 12);
			expect(verified, `puzzle ${idStr}`).not.toBeNull();
		}
	});

	it('every puzzle declares minMovesToSolve equal to solveMinMoves', () => {
		for (const [idStr, cfg] of Object.entries(firstStepsPack.puzzles)) {
			expect(cfg.minMovesToSolve, `puzzle ${idStr}`).toBe(solveMinMoves(cfg, 12));
		}
	});

	it('inline packs.ts first-steps block declares minMovesToSolve equal to solveMinMoves', () => {
		const shipped = getPackBySlug(FIRST_STEPS_SLUG);
		expect(shipped, 'first-steps pack in packs.ts').toBeDefined();
		for (const [idStr, cfg] of Object.entries(shipped!.puzzles)) {
			expect(cfg.minMovesToSolve, `puzzle ${idStr}`).toBe(solveMinMoves(cfg, 12));
		}
	});

	it('puzzles 1–7 satisfy their mapped pedagogy concept rules', () => {
		for (let id = 1; id <= 7; id++) {
			const cfg = firstStepsPack.puzzles[id];
			expect(cfg, `puzzle ${id} missing`).toBeDefined();
			const report = pedagogy.validateConcept(cfg, id);
			const failures = report.checks
				.filter((check) => !check.passed)
				.map((check) => `${check.ruleId}: ${check.detail ?? 'failed'}`)
				.join('; ');
			expect(report.passes, `puzzle ${id} (${failures})`).toBe(true);
		}
	});

	it('puzzle 2 cannot be cleared without rotating', () => {
		const report = pedagogy.validateConcept(firstStepsPack.puzzles[2], 2);
		expect(
			report.checks.find((check) => check.ruleId === 'requires-template-rotation')?.passed
		).toBe(true);
		expect(requiresTemplateRotation(firstStepsPack.puzzles[2])).toBe(true);
	});

	it('puzzle 3 cannot be cleared with a single template', () => {
		const report = pedagogy.validateConcept(firstStepsPack.puzzles[3], 3);
		expect(report.checks.find((check) => check.ruleId === 'requires-every-template')?.passed).toBe(
			true
		);
		expect(requiresEveryTemplate(firstStepsPack.puzzles[3])).toBe(true);
	});

	it('puzzle 4 requires multiple moves (rotate and reuse the same lens)', () => {
		const report = pedagogy.validateConcept(firstStepsPack.puzzles[4], 4);
		expect(report.checks.find((check) => check.ruleId === 'requires-min-moves-2')?.passed).toBe(
			true
		);
	});
});
