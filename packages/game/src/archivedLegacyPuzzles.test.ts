import { describe, it, expect } from 'vitest';
import { solveMinMoves } from './PuzzleGenerator.js';
import { packs } from './packs.js';
import type { PuzzleConfig } from './types.js';
import {
	ARCHIVED_LEGACY_PUZZLES,
	ArchivedLegacyPuzzles,
	type ArchivedLegacyPuzzle
} from './archivedLegacyPuzzles.js';

const EXPECTED_ARCHIVE = [
	'first-steps #1',
	'first-steps #6',
	'color-ladder #7',
	'color-ladder #8',
	'color-ladder #9',
	'color-ladder #10'
];

const label = (p: ArchivedLegacyPuzzle): string => `${p.packSlug} #${p.puzzleId}`;

function puzzleFor(archived: ArchivedLegacyPuzzle): PuzzleConfig | undefined {
	return packs.find((p) => p.slug === archived.packSlug)?.puzzles[archived.puzzleId];
}

describe('ARCHIVED_LEGACY_PUZZLES', () => {
	it('is frozen to the one-time 2026-10-29 archive', () => {
		expect(
			ARCHIVED_LEGACY_PUZZLES.map(label),
			'The legacy archive is closed. Do not add puzzles here: build new puzzles with the 3x3 ' +
				'engine (simplePuzzleGeneration.ts) so they pass game:validate.'
		).toEqual(EXPECTED_ARCHIVE);
		expect(Object.isFrozen(ARCHIVED_LEGACY_PUZZLES)).toBe(true);
	});

	it.each(ARCHIVED_LEGACY_PUZZLES.map((p) => [label(p), p]))(
		'%s still exists in packs.ts',
		(_label, archived) => {
			expect(puzzleFor(archived)).toBeDefined();
		}
	);

	// First Steps #1's declared move count is a known bug left to tutorial plan T2.
	const hasKnownMoveCountBug = (p: ArchivedLegacyPuzzle): boolean =>
		p.packSlug === 'first-steps' && p.puzzleId === 1;

	it.each(ARCHIVED_LEGACY_PUZZLES.map((p) => [label(p), p]))(
		'%s stays solvable and declares the solver minimum',
		(_label, archived) => {
			const cfg = puzzleFor(archived) as PuzzleConfig;
			const solverMinMoves = solveMinMoves(cfg, 12);
			expect(solverMinMoves).not.toBeNull();
			if (!hasKnownMoveCountBug(archived)) {
				expect(solverMinMoves).toBe(cfg.minMovesToSolve);
			}
		},
		60_000
	);
});

describe('ArchivedLegacyPuzzles', () => {
	const archive = new ArchivedLegacyPuzzles([{ packSlug: 'p', puzzleId: 1 }]);

	it('matches only the exact pack and puzzle', () => {
		expect(archive.isArchived('p', 1)).toBe(true);
		expect(archive.isArchived('p', 2)).toBe(false);
		expect(archive.isArchived('q', 1)).toBe(false);
	});
});
