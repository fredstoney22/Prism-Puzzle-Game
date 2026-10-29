import { describe, it, expect } from 'vitest';
import { solveMinMoves } from './PuzzleGenerator.js';
import { packs } from './packs.js';
import { COLOR_LADDER_VALIDATION_EXEMPTIONS } from './packGenerationSpecs.js';
import { validateMultiPigmentTemplateCounts } from './pigmentTemplates.js';
import { FIRST_STEPS_VALIDATION_EXEMPTIONS } from './puzzles/firstSteps.js';
import { findTemplateContainment } from './templateContainment.js';
import { countActiveCells, MIN_TEMPLATE_ACTIVE_CELLS } from './templateShape.js';
import type { PuzzleConfig } from './types.js';
import {
	PACK_VALIDATION_EXEMPTIONS,
	ValidationExemptions,
	type PuzzleValidationExemption,
	type ValidationRuleId
} from './validationExemptions.js';

const RULE_VIOLATED: Record<ValidationRuleId, (cfg: PuzzleConfig) => boolean> = {
	'min-template-active-cells': (cfg) =>
		cfg.templates.some((t) => countActiveCells(t.shape) < MIN_TEMPLATE_ACTIVE_CELLS),
	'template-containment': (cfg) => findTemplateContainment(cfg.templates).length > 0,
	'multi-pigment-template-count': (cfg) => !validateMultiPigmentTemplateCounts(cfg.templates).ok
};

function puzzleFor(exemption: PuzzleValidationExemption): PuzzleConfig | undefined {
	return packs.find((p) => p.slug === exemption.packSlug)?.puzzles[exemption.puzzleId];
}

describe('ValidationExemptions', () => {
	const exemptions = new ValidationExemptions([
		{ packSlug: 'p', puzzleId: 1, rule: 'template-containment', reason: 'deliberate' }
	]);

	it('matches only the exact pack, puzzle, and rule', () => {
		expect(exemptions.find('p', 1, 'template-containment')?.reason).toBe('deliberate');
		expect(exemptions.find('p', 2, 'template-containment')).toBeUndefined();
		expect(exemptions.find('q', 1, 'template-containment')).toBeUndefined();
		expect(exemptions.find('p', 1, 'min-template-active-cells')).toBeUndefined();
	});

	it('rejects an exemption without a stated reason', () => {
		expect(
			() =>
				new ValidationExemptions([
					{ packSlug: 'p', puzzleId: 1, rule: 'template-containment', reason: '  ' }
				])
		).toThrow(/reason/);
	});

	it('combines the First Steps and Color Ladder exemptions', () => {
		expect(PACK_VALIDATION_EXEMPTIONS).toEqual([
			...FIRST_STEPS_VALIDATION_EXEMPTIONS,
			...COLOR_LADDER_VALIDATION_EXEMPTIONS
		]);
	});
});

describe('PACK_VALIDATION_EXEMPTIONS', () => {
	it.each(PACK_VALIDATION_EXEMPTIONS.map((e) => [`${e.packSlug} #${e.puzzleId} ${e.rule}`, e]))(
		'%s targets a real puzzle that still violates the exempted rule',
		(_label, exemption) => {
			const cfg = puzzleFor(exemption);
			expect(cfg).toBeDefined();
			expect(RULE_VIOLATED[exemption.rule](cfg as PuzzleConfig)).toBe(true);
		}
	);

	// First Steps #1's declared move count is tracked separately (tutorial plan T2).
	const isMoveCountTrackedElsewhere = (e: PuzzleValidationExemption): boolean =>
		e.packSlug === 'first-steps' && e.puzzleId === 1;

	it.each(PACK_VALIDATION_EXEMPTIONS.map((e) => [`${e.packSlug} #${e.puzzleId}`, e]))(
		'%s stays solvable and declares the solver minimum',
		(_label, exemption) => {
			const cfg = puzzleFor(exemption) as PuzzleConfig;
			const solverMinMoves = solveMinMoves(cfg, 12);
			expect(solverMinMoves).not.toBeNull();
			if (!isMoveCountTrackedElsewhere(exemption)) {
				expect(solverMinMoves).toBe(cfg.minMovesToSolve);
			}
		},
		60_000
	);
});
