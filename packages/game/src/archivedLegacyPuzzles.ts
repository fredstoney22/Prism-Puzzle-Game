/**
 * One-time archive of legacy puzzles, recorded 2026-10-29 at the owner's request
 * ("archive legacy puzzles this one time instead of modifying them").
 *
 * These shipped puzzles predate current `game:validate` rules. They stay playable and
 * unchanged; `game:validate` skips them. This list is closed: new puzzles must pass
 * validation (build them with the 3x3 engine in simplePuzzleGeneration.ts), and
 * archivedLegacyPuzzles.test.ts fails if an entry is added.
 */

export interface ArchivedLegacyPuzzle {
	packSlug: string;
	puzzleId: number;
}

export const ARCHIVED_LEGACY_PUZZLES: readonly ArchivedLegacyPuzzle[] = Object.freeze([
	{ packSlug: 'first-steps', puzzleId: 1 },
	{ packSlug: 'first-steps', puzzleId: 6 },
	{ packSlug: 'color-ladder', puzzleId: 7 },
	{ packSlug: 'color-ladder', puzzleId: 8 },
	{ packSlug: 'color-ladder', puzzleId: 9 },
	{ packSlug: 'color-ladder', puzzleId: 10 }
]);

export class ArchivedLegacyPuzzles {
	constructor(private readonly puzzles: readonly ArchivedLegacyPuzzle[]) {}

	isArchived(packSlug: string, puzzleId: number): boolean {
		return this.puzzles.some((p) => p.packSlug === packSlug && p.puzzleId === puzzleId);
	}
}
