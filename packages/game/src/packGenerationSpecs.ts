/**
 * Per-pack generation parameters — each pack defines its own puzzle slots.
 */

import { repeatSlot, type PackGenerationSpec, type PuzzleSlotSpec } from './packGenerationTypes.js';
import type { Pigment } from './types.js';

const mono = (targetMinMoves: number, templateSizes: number[]): PuzzleSlotSpec => ({
	kind: 'mono',
	puzzleSize: 3,
	targetMinMoves,
	templateSizes
});

const color = (
	targetMinMoves: number,
	allowedPigments: Pigment[],
	overrides: Partial<PuzzleSlotSpec> = {}
): PuzzleSlotSpec => {
	const pool = allowedPigments.filter((p) => p !== 0);
	const minMultiColored = overrides.minMultiColoredTemplates ?? 0;
	return {
		kind: 'color',
		puzzleSize: 3,
		targetMinMoves,
		allowedPigments,
		distinctPigmentCount: overrides.distinctPigmentCount ?? pool.length,
		maxPigmentsPerTemplate: overrides.maxPigmentsPerTemplate ?? (minMultiColored > 0 ? 2 : 1),
		...overrides
	};
};

/** Packs whose puzzles are produced by the generator (not hand-authored). */
export const PACK_GENERATION_SPECS: PackGenerationSpec[] = [
	{
		name: 'Tutorial (Auto)',
		slug: 'tutorial-auto',
		access: 'free',
		puzzles: repeatSlot(mono(2, [2, 3]), 5)
	},
	{
		name: 'Easy (Auto)',
		slug: 'easy-auto',
		access: 'free',
		puzzles: repeatSlot(mono(3, [2, 3, 3]), 5)
	},
	{
		name: 'Medium (Auto)',
		slug: 'medium-auto',
		access: 'free',
		puzzles: repeatSlot(mono(3, [2, 3, 3]), 5)
	},
	{
		name: 'Hard (Auto)',
		slug: 'hard-auto',
		access: 'paid',
		puzzles: repeatSlot(mono(4, [3, 3, 3]), 5)
	},
	{
		name: 'Expert (Auto)',
		slug: 'expert-auto',
		access: 'paid',
		puzzles: repeatSlot(mono(5, [3, 3, 3]), 5)
	},
	{
		name: 'Color Spectrum',
		slug: 'color-spectrum',
		access: 'free',
		puzzles: [
			color(2, [2], { templateCount: 2 }),
			color(2, [1], { templateCount: 2 }),
			color(2, [4], { templateCount: 2 }),
			color(3, [3], { templateCount: 3 }),
			color(3, [6], { templateCount: 3 }),
			color(3, [5], { templateCount: 3 }),
			color(4, [1, 2], { templateCount: 4, minMultiColoredTemplates: 1 }),
			color(6, [1, 2, 4], { templateCount: 6, minMultiColoredTemplates: 1 }),
			color(6, [3, 5, 6], { templateCount: 6, minMultiColoredTemplates: 2 }),
			color(6, [1, 3, 6], { templateCount: 6, minMultiColoredTemplates: 2 })
		]
	},
	{
		name: 'Chromatic Ascent',
		slug: 'chromatic-ascent',
		access: 'paid',
		puzzles: [
			color(2, [2]),
			color(2, [1]),
			color(2, [4]),
			color(3, [3]),
			color(3, [6]),
			color(3, [5]),
			color(4, [1, 2], { minMultiColoredTemplates: 1 }),
			color(6, [1, 2, 4], { minMultiColoredTemplates: 1 }),
			color(6, [3, 5, 6], { minMultiColoredTemplates: 2 }),
			color(6, [1, 4, 6], { minMultiColoredTemplates: 2 })
		]
	},
	/** 3×3 RYB color pack — 10 puzzles, max 3 templates, all stencils used on shortest path. */
	{
		name: 'Color Ladder',
		slug: 'color-ladder',
		access: 'free',
		puzzles: [
			color(2, [2], { templateCount: 2 }),
			color(2, [1], { templateCount: 2 }),
			color(2, [4], { templateCount: 2 }),
			color(3, [3], { templateCount: 3 }),
			color(3, [6], { templateCount: 3 }),
			color(3, [5], { templateCount: 3 }),
			color(4, [1, 2], {
				templateCount: 3,
				minMultiColoredTemplates: 1,
				minTemplatesPerPigment: 1
			}),
			color(5, [1, 2, 4], {
				templateCount: 3,
				minMultiColoredTemplates: 1,
				minTemplatesPerPigment: 1
			}),
			color(6, [1, 2, 4], {
				templateCount: 3,
				minMultiColoredTemplates: 2,
				minTemplatesPerPigment: 1
			}),
			color(6, [1, 4, 6], {
				templateCount: 3,
				minMultiColoredTemplates: 2,
				minTemplatesPerPigment: 1
			})
		]
	},
	/** Dev-only (not in productionPacks.ts): 4×4 mono flip, 30 puzzles easiest → hardest. */
	{
		name: '4×4 Grid (Dev)',
		slug: 'grid-4x4-dev',
		access: 'free',
		pool: {
			puzzleCount: 30,
			candidatesPerPack: 80,
			puzzleSize: 4,
			kind: 'mono',
			templateCountMin: 2,
			templateCountMax: 4,
			templateSizeOptions: [2, 3],
			scramble: {
				maxMoves: 15,
				maxExtraAfterCoverage: 3,
				rotateSameTemplateWeight: 0.25
			},
			pruneUnusedTemplates: true
		}
	},
	/** 3×3 mono pack — 50 puzzles, 2–3 templates, easiest → hardest. */
	{
		name: 'Monochrome',
		slug: 'monochrome',
		access: 'free',
		pool: {
			puzzleCount: 50,
			candidatesPerPack: 150,
			puzzleSize: 3,
			kind: 'mono',
			templateCountMin: 2,
			templateCountMax: 3,
			templateSizeOptions: [3],
			scramble: {
				maxMoves: 15,
				maxExtraAfterCoverage: 3,
				rotateSameTemplateWeight: 0.25
			},
			pruneUnusedTemplates: true
		}
	},
	/** 3×3 RYB color pack — 50 puzzles, 3 templates, easiest → hardest. */
	{
		name: 'Multicolor',
		slug: 'multicolor',
		access: 'free',
		pool: {
			puzzleCount: 50,
			candidatesPerPack: 150,
			puzzleSize: 3,
			kind: 'color',
			allowedPigments: [1, 2, 4] as Pigment[],
			templateCount: 3,
			minMultiColoredTemplates: 1,
			minTemplatesPerPigment: 1,
			scramble: {
				maxMoves: 15,
				maxExtraAfterCoverage: 3,
				rotateSameTemplateWeight: 0.25
			},
			pruneUnusedTemplates: true
		}
	}
];

/** Hand-preserved Color Ladder puzzle 6 — unused third stencil removed. */
export const COLOR_LADDER_PUZZLE_6 = {
	startState: [
		[5, 0, 0],
		[5, 5, 0],
		[5, 0, 5]
	],
	templates: [
		{
			shape: [
				[0, 5, 5],
				[0, 0, 5],
				[0, 0, 0]
			]
		},
		{
			shape: [
				[0, 5],
				[5, 0],
				[5, 0]
			]
		}
	],
	solvedValue: 0 as const,
	minMovesToSolve: 3
};

/** Regeneration specs for hand-maintained packs (e.g. containment fixes). */
export const COLOR_LAB_REGEN_SLOTS: PuzzleSlotSpec[] = [
	color(3, [2], { templateCount: 3 }),
	color(4, [1, 2], { templateCount: 4 }),
	color(6, [1, 2, 4], { templateCount: 6 }),
	color(6, [3, 5, 6], { templateCount: 6 }),
	color(6, [1, 3, 6], { templateCount: 6 })
];

export const INTRO_PACK_REGEN_SLOTS: Record<number, PuzzleSlotSpec> = {
	6: { kind: 'mono', puzzleSize: 3, targetMinMoves: 2, templateCount: 2 },
	7: { kind: 'mono', puzzleSize: 3, targetMinMoves: 3, templateCount: 3 },
	8: { kind: 'mono', puzzleSize: 3, targetMinMoves: 3, templateCount: 3 },
	9: { kind: 'mono', puzzleSize: 3, targetMinMoves: 3, templateCount: 3 }
};

/**
 * Regeneration specs for First Steps (hand-maintained, not pool/slot-driven —
 * see puzzles/firstSteps.ts) puzzles whose original templates were smaller
 * than the 3×3 puzzle grid. Every template must match puzzleSize so the pack
 * stays visually and mechanically consistent; targetMinMoves preserves each
 * puzzle's original difficulty. Puzzles 1, 2, 3, 6 were already 3×3 and are
 * untouched. Puzzle 4's original concept ("smaller lenses you can place
 * anywhere") is inherently impossible at 3×3 — see firstStepsTutorials.ts for
 * the accompanying copy change.
 */
export const FIRST_STEPS_REGEN_SLOTS: Record<number, PuzzleSlotSpec> = {
	4: { kind: 'mono', puzzleSize: 3, targetMinMoves: 3, templateSizes: [3] },
	5: color(2, [1, 2], { minTemplatesPerPigment: 1, minShapeSize: 3, maxShapeSize: 3 }),
	7: color(6, [1, 2, 4], { minTemplatesPerPigment: 1, minShapeSize: 3, maxShapeSize: 3 }),
	8: color(4, [1, 2], {
		minTemplatesPerPigment: 1,
		minMultiColoredTemplates: 1,
		minShapeSize: 3,
		maxShapeSize: 3
	})
};

export function getPackGenerationSpec(slug: string): PackGenerationSpec | undefined {
	return PACK_GENERATION_SPECS.find((spec) => spec.slug === slug);
}

export function getAutoGeneratedPackSlugs(): string[] {
	return PACK_GENERATION_SPECS.map((spec) => spec.slug);
}

/** Packs whose mono puzzles use `squareTemplate` (templateSizes / mono pool), not random color shapes. */
export function packUsesMonoSquareTemplateGeneration(slug: string): boolean {
	const spec = getPackGenerationSpec(slug);
	if (!spec) return false;
	if (spec.pool?.kind === 'mono') return true;
	return (spec.puzzles ?? []).some(
		(slot) => slot.kind === 'mono' && (slot.templateSizes?.length ?? 0) > 0
	);
}

export const MONO_SQUARE_TEMPLATE_PACK_SLUGS = PACK_GENERATION_SPECS.filter((spec) =>
	packUsesMonoSquareTemplateGeneration(spec.slug)
).map((spec) => spec.slug);
