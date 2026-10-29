/**
 * One-time archive of legacy puzzles, recorded 2026-10-29 at the owner's request
 * ("archive legacy puzzles this one time instead of modifying them").
 *
 * These shipped puzzles predate current `game:validate` rules. They stay playable and
 * unchanged. ("Archived" here means "kept as-is, validation baseline frozen" — unlike
 * puzzles/firstStepsArchive.ts, which holds puzzles removed from a pack.)
 *
 * `game:validate` runs every static rule on them and suppresses only each entry's exact
 * `knownErrors`. Each entry is pinned to its content by `fingerprint`
 * (`canonicalPuzzleKey`), so editing, reordering or regenerating an archived puzzle
 * fails validation. Pinned puzzles are not re-solved by `game:validate` (the BFS is slow
 * and pinned content can't change solvability); archivedLegacyPuzzles.test.ts checks
 * their recorded `solverMinMoves` instead.
 *
 * This list is closed: new puzzles must pass validation. Create them with the planned
 * 3x3 creation engine (docs/generation-engine-overhaul.md).
 * archivedLegacyPuzzles.test.ts fails if an entry is added.
 */

import { canonicalPuzzleKey } from './puzzleCanonical.js';
import type { PuzzleConfig } from './types.js';

export interface ArchivedLegacyPuzzle {
	readonly packSlug: string;
	readonly puzzleId: number;
	/** `canonicalPuzzleKey` of the puzzle as archived. */
	readonly fingerprint: string;
	/** Exact `game:validate` error messages this puzzle had when archived. */
	readonly knownErrors: readonly string[];
	/**
	 * `solveMinMoves(cfg, 12)` recorded at archive time. `game:validate` doesn't re-solve
	 * archived puzzles; the fingerprint pins the content, so this can't go stale.
	 */
	readonly solverMinMoves: number;
}

function freezeEntry(entry: ArchivedLegacyPuzzle): ArchivedLegacyPuzzle {
	Object.freeze(entry.knownErrors);
	return Object.freeze(entry);
}

const PIGMENT_1_SINGLE =
	'pigment 1 has 1 template(s); multi-color puzzles need at least 2 per color';

export const ARCHIVED_LEGACY_PUZZLES: readonly ArchivedLegacyPuzzle[] = Object.freeze(
	[
		{
			packSlug: 'first-steps',
			puzzleId: 1,
			solverMinMoves: 3,
			fingerprint: '0,0,0|1,0,1|0,1,0::000|000|010:000|000|010::sv0',
			knownErrors: ['template[0] has 1 active cell(s); minimum is 2']
		},
		{
			packSlug: 'first-steps',
			puzzleId: 6,
			solverMinMoves: 3,
			fingerprint:
				'0,0,0|4,5,1|0,0,0::000|000|110:000|000|110;000|000|440:000|000|440;' +
				'001|050|400:001|050|400::sv0',
			knownErrors: [
				'template 1 is completely contained in template 2',
				'template 2 is completely contained in template 1'
			]
		},
		{
			packSlug: 'color-ladder',
			puzzleId: 7,
			solverMinMoves: 4,
			fingerprint: '0,3,0|1,1,0|0,2,1::000|022|110:000|022|110;011|101:011|101::sv0',
			knownErrors: [
				'pigment 2 has 1 template(s); multi-color puzzles need at least 2 per color'
			]
		},
		{
			packSlug: 'color-ladder',
			puzzleId: 8,
			solverMinMoves: 5,
			fingerprint:
				'0,2,0|4,5,6|2,5,3::000|000|222:000|000|222;00|11|10:00|11|10;00|44|02:00|44|02::sv0',
			knownErrors: [PIGMENT_1_SINGLE]
		},
		{
			packSlug: 'color-ladder',
			puzzleId: 9,
			solverMinMoves: 6,
			fingerprint: '0,0,2|7,1,0|0,6,4::002|400:002|400;00|11:00|11;02|40:02|40::sv0',
			knownErrors: [PIGMENT_1_SINGLE]
		},
		{
			packSlug: 'color-ladder',
			puzzleId: 10,
			solverMinMoves: 6,
			fingerprint: '7,5,1|0,6,7|1,5,4::000|046:000|046;001|001:001|001;00|06|40:00|06|40::sv0',
			knownErrors: [PIGMENT_1_SINGLE]
		}
	].map(freezeEntry)
);

interface ValidationIssueLike {
	severity: 'error' | 'warn';
	message: string;
}

export interface ArchivedFilterResult<T extends ValidationIssueLike> {
	isArchived: boolean;
	/** Issues to report as usual. */
	remaining: T[];
	/** Known errors recorded at archive time, not reported. */
	suppressed: T[];
	/** Set when the archived puzzle's content no longer matches its fingerprint. */
	contentError?: string;
}

export class ArchivedLegacyPuzzles {
	constructor(private readonly puzzles: readonly ArchivedLegacyPuzzle[]) {}

	filterKnownErrors<T extends ValidationIssueLike>(
		packSlug: string,
		puzzleId: number,
		cfg: PuzzleConfig,
		issues: T[]
	): ArchivedFilterResult<T> {
		const entry = this.find(packSlug, puzzleId);
		if (entry === undefined) return { isArchived: false, remaining: issues, suppressed: [] };

		if (canonicalPuzzleKey(cfg) !== entry.fingerprint) {
			return {
				isArchived: true,
				remaining: issues,
				suppressed: [],
				contentError:
					'archived puzzle changed or moved (content no longer matches its fingerprint in ' +
					'archivedLegacyPuzzles.ts); legacy errors are no longer suppressed'
			};
		}

		const isKnown = (issue: T): boolean =>
			issue.severity === 'error' && entry.knownErrors.includes(issue.message);
		return {
			isArchived: true,
			remaining: issues.filter((issue) => !isKnown(issue)),
			suppressed: issues.filter(isKnown)
		};
	}

	/**
	 * True when the puzzle is archived and its content still matches its fingerprint.
	 * `game:validate` skips the expensive solve for these: pinned content can't change
	 * solvability.
	 */
	isPinnedUnchanged(packSlug: string, puzzleId: number, cfg: PuzzleConfig): boolean {
		const entry = this.find(packSlug, puzzleId);
		return entry !== undefined && canonicalPuzzleKey(cfg) === entry.fingerprint;
	}

	/** Labels of archived entries whose pack/puzzle no longer exists. */
	findMissing(lookup: (packSlug: string, puzzleId: number) => PuzzleConfig | undefined): string[] {
		return this.puzzles
			.filter((p) => lookup(p.packSlug, p.puzzleId) === undefined)
			.map((p) => `${p.packSlug} #${p.puzzleId}`);
	}

	private find(packSlug: string, puzzleId: number): ArchivedLegacyPuzzle | undefined {
		return this.puzzles.find((p) => p.packSlug === packSlug && p.puzzleId === puzzleId);
	}
}
