import { describe, it, expect } from 'vitest';
import { solveMinMoves } from './PuzzleGenerator.js';
import { packs } from './packs.js';
import { canonicalPuzzleKey } from './puzzleCanonical.js';
import type { PuzzleConfig } from './types.js';
import {
	ARCHIVED_LEGACY_PUZZLES,
	ArchivedLegacyPuzzles,
	type ArchivedLegacyPuzzle
} from './archivedLegacyPuzzles.js';

const label = (p: ArchivedLegacyPuzzle): string => `${p.packSlug} #${p.puzzleId}`;

function requirePuzzle(archived: ArchivedLegacyPuzzle): PuzzleConfig {
	const cfg = packs.find((p) => p.slug === archived.packSlug)?.puzzles[archived.puzzleId];
	expect(cfg, `${label(archived)} is missing from packs.ts`).toBeDefined();
	if (cfg === undefined) throw new Error(`${label(archived)} is missing from packs.ts`);
	return cfg;
}

describe('ARCHIVED_LEGACY_PUZZLES', () => {
	it('is frozen to the one-time 2026-10-29 archive (6 puzzles, 7 known errors)', () => {
		expect(
			ARCHIVED_LEGACY_PUZZLES.map(label),
			'The legacy archive is closed. Do not add puzzles here: new puzzles must pass ' +
				'game:validate; create them with the planned 3x3 creation engine ' +
				'(docs/generation-engine-overhaul.md).'
		).toEqual([
			'first-steps #1',
			'first-steps #6',
			'color-ladder #7',
			'color-ladder #8',
			'color-ladder #9',
			'color-ladder #10'
		]);
		expect(ARCHIVED_LEGACY_PUZZLES.flatMap((p) => p.knownErrors)).toHaveLength(7);
	});

	it('is deeply frozen', () => {
		expect(Object.isFrozen(ARCHIVED_LEGACY_PUZZLES)).toBe(true);
		for (const entry of ARCHIVED_LEGACY_PUZZLES) {
			expect(Object.isFrozen(entry), label(entry)).toBe(true);
			expect(Object.isFrozen(entry.knownErrors), label(entry)).toBe(true);
		}
	});

	it.each(ARCHIVED_LEGACY_PUZZLES.map((p) => [label(p), p]))(
		'%s still exists with unchanged content (fingerprint matches)',
		(_label, archived) => {
			expect(canonicalPuzzleKey(requirePuzzle(archived))).toBe(archived.fingerprint);
		}
	);

	it.each(ARCHIVED_LEGACY_PUZZLES.map((p) => [label(p), p]))(
		'%s declares the recorded solver minimum',
		(_label, archived) => {
			const cfg = requirePuzzle(archived);
			if (archived.packSlug === 'first-steps' && archived.puzzleId === 1) {
				// Known bug, fixed by tutorial plan T2.
				expect(
					[cfg.minMovesToSolve, archived.solverMinMoves],
					'First Steps #1 move count looks fixed (tutorial T2): remove this special case ' +
						'so the normal minMovesToSolve check applies.'
				).toEqual([1, 3]);
				return;
			}
			expect(cfg.minMovesToSolve).toBe(archived.solverMinMoves);
		}
	);

	// Re-checks the recorded solverMinMoves with the real solver. Skipped for puzzles whose
	// BFS is slow (color-ladder #9 takes ~5-7s); the fingerprint test above pins their
	// content, so their recorded result can't go stale.
	const SLOW_TO_SOLVE = new Set(['color-ladder #9']);
	it.each(
		ARCHIVED_LEGACY_PUZZLES.filter((p) => !SLOW_TO_SOLVE.has(label(p))).map((p) => [label(p), p])
	)('%s solver result matches the recorded solverMinMoves', (_label, archived) => {
		expect(solveMinMoves(requirePuzzle(archived), 12)).toBe(archived.solverMinMoves);
	});
});

describe('ArchivedLegacyPuzzles', () => {
	const cfg: PuzzleConfig = {
		startState: [
			[1, 0],
			[0, 0]
		],
		templates: [{ shape: [[1]] }],
		solvedValue: 0
	};
	const archive = new ArchivedLegacyPuzzles([
		{
			packSlug: 'p',
			puzzleId: 1,
			fingerprint: canonicalPuzzleKey(cfg),
			knownErrors: ['known'],
			solverMinMoves: 1
		}
	]);
	const issue = (severity: 'error' | 'warn', message: string) => ({ severity, message });

	it('ignores puzzles that are not archived', () => {
		const issues = [issue('error', 'known')];
		const result = archive.filterKnownErrors('p', 2, cfg, issues);
		expect(result.isArchived).toBe(false);
		expect(result.remaining).toEqual(issues);
		expect(result.suppressed).toEqual([]);
		expect(result.contentError).toBeUndefined();
	});

	it('suppresses only the recorded known errors', () => {
		const result = archive.filterKnownErrors('p', 1, cfg, [
			issue('error', 'known'),
			issue('error', 'new problem'),
			issue('warn', 'known')
		]);
		expect(result.isArchived).toBe(true);
		expect(result.suppressed).toEqual([issue('error', 'known')]);
		expect(result.remaining).toEqual([issue('error', 'new problem'), issue('warn', 'known')]);
	});

	it('reports an error when the archived puzzle content changed or moved', () => {
		const changed: PuzzleConfig = { ...cfg, templates: [{ shape: [[1, 1]] }] };
		const result = archive.filterKnownErrors('p', 1, changed, [issue('error', 'known')]);
		expect(result.suppressed).toEqual([]);
		expect(result.remaining).toEqual([issue('error', 'known')]);
		expect(result.contentError).toMatch(/archived puzzle changed or moved/);
	});

	it('reports a puzzle as pinned only when archived and unchanged', () => {
		const changed: PuzzleConfig = { ...cfg, templates: [{ shape: [[1, 1]] }] };
		expect(archive.isPinnedUnchanged('p', 1, cfg)).toBe(true);
		expect(archive.isPinnedUnchanged('p', 1, changed)).toBe(false);
		expect(archive.isPinnedUnchanged('p', 2, cfg)).toBe(false);
	});

	it('has no content error when the fingerprint matches', () => {
		expect(archive.filterKnownErrors('p', 1, cfg, []).contentError).toBeUndefined();
	});

	it('lists archived entries whose puzzle no longer exists', () => {
		expect(archive.findMissing(() => undefined)).toEqual(['p #1']);
		expect(archive.findMissing(() => cfg)).toEqual([]);
	});
});
