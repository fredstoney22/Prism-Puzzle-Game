/**
 * First Steps — one new concept per puzzle, in teaching order.
 * Early puzzles teach placement; later puzzles introduce rotation, multiple templates, and color.
 */

import type { PackDefinition, PuzzleConfig } from '../types.js';

export const FIRST_STEPS_SLUG = 'first-steps';

/** Short concept label for each puzzle (puzzle list / in-game hints). */
export const FIRST_STEPS_CONCEPTS: Record<number, string> = {
	1: 'Applying a template',
	2: 'Rotating a template',
	3: 'Multiple lenses',
	4: 'Reusing a lens',
	5: 'Multiple colors',
	6: 'Multi-color lenses',
	7: 'Color mixing',
	8: 'Multi-color stencils',
	9: 'Putting it all together'
};

const puzzles: Record<number, PuzzleConfig> = {
	1: {
		startState: [
			[0, 1, 0],
			[0, 0, 1],
			[0, 1, 0]
		],
		templates: [
			{
				shape: [
					[0, 1, 0],
					[0, 0, 0],
					[0, 0, 0]
				]
			}
		],
		solvedValue: 0,
		minMovesToSolve: 1
	},
	2: {
		startState: [
			[0, 0, 1],
			[0, 1, 0],
			[1, 0, 1]
		],
		templates: [
			{
				shape: [
					[1, 0, 0],
					[0, 1, 0],
					[0, 0, 0]
				]
			}
		],
		solvedValue: 0,
		minMovesToSolve: 3
	},
	3: {
		startState: [
			[1, 1, 1],
			[1, 0, 1],
			[0, 0, 0]
		],
		templates: [
			{
				shape: [
					[0, 1, 0],
					[1, 0, 1],
					[0, 0, 0]
				]
			},
			{
				shape: [
					[1, 0, 0],
					[0, 0, 0],
					[1, 0, 0]
				]
			}
		],
		solvedValue: 0,
		minMovesToSolve: 2
	},
	4: {
		startState: [
			[0, 0, 0],
			[0, 0, 0],
			[1, 0, 0]
		],
		templates: [
			{
				shape: [
					[1, 0, 0],
					[0, 0, 0],
					[1, 0, 1]
				]
			}
		],
		solvedValue: 0,
		minMovesToSolve: 3
	},
	5: {
		startState: [
			[0, 0, 0],
			[2, 0, 0],
			[1, 0, 3]
		],
		templates: [
			{
				shape: [
					[1, 0, 1],
					[0, 0, 0],
					[0, 0, 0]
				]
			},
			{
				shape: [
					[2, 0, 0],
					[0, 0, 2],
					[0, 0, 0]
				]
			}
		],
		solvedValue: 0,
		minMovesToSolve: 2
	},
	6: {
		startState: [
			[0, 0, 0],
			[4, 5, 1],
			[0, 0, 0]
		],
		templates: [
			{
				shape: [
					[4, 0, 0],
					[0, 5, 0],
					[0, 0, 1]
				]
			},
			{
				shape: [
					[4, 0, 0],
					[4, 0, 0],
					[0, 0, 0]
				]
			},
			{
				shape: [
					[0, 0, 0],
					[0, 0, 1],
					[0, 0, 1]
				]
			}
		],
		solvedValue: 0,
		minMovesToSolve: 3
	},
	7: {
		startState: [
			[6, 0, 1],
			[2, 0, 7],
			[5, 5, 2]
		],
		templates: [
			{
				shape: [
					[1, 1, 0],
					[0, 1, 1],
					[1, 1, 0]
				]
			},
			{
				shape: [
					[2, 2, 2],
					[2, 0, 0],
					[0, 0, 0]
				]
			},
			{
				shape: [
					[4, 4, 0],
					[4, 0, 4],
					[0, 0, 0]
				]
			}
		],
		solvedValue: 0,
		minMovesToSolve: 6
	},
	8: {
		startState: [
			[0, 3, 1],
			[3, 2, 0],
			[0, 2, 1]
		],
		templates: [
			{
				shape: [
					[1, 0, 1],
					[1, 0, 1],
					[1, 1, 1]
				]
			},
			{
				shape: [
					[0, 2, 0],
					[1, 2, 0],
					[1, 0, 1]
				]
			}
		],
		solvedValue: 0,
		minMovesToSolve: 4
	}
};

export const firstStepsPack: PackDefinition = {
	name: 'First Steps',
	slug: FIRST_STEPS_SLUG,
	access: 'free',
	puzzles
};

export function getFirstStepsConcept(puzzleId: number): string | undefined {
	return FIRST_STEPS_CONCEPTS[puzzleId];
}
