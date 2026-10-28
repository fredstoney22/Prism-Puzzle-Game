/**
 * Validate the algebraic min-move solver against BFS across real pack data —
 * correctness (must match exactly) and timing (the actual point of building it).
 *
 * Run from app-template:
 *   npx tsx packages/game/scripts/validate-algebraic-solver.ts
 *   npx tsx packages/game/scripts/validate-algebraic-solver.ts --slug=multicolor,color-ladder
 */
import { getPackBySlug, packs } from '../src/packs.js';
import { solveMinMoves } from '../src/puzzleSolver.js';
import { solveMinMovesAlgebraic } from '../src/puzzleAlgebraicSolver.js';
import type { PuzzleConfig } from '../src/types.js';

const DEFAULT_SLUGS = [
	'multicolor',
	'color-ladder',
	'color-spectrum',
	'chromatic-ascent',
	'color-lab',
	'monochrome',
	'first-steps'
];

function parseSlugs(): string[] {
	const arg = process.argv.find((entry) => entry.startsWith('--slug='));
	if (!arg) return DEFAULT_SLUGS;
	return arg
		.slice('--slug='.length)
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function bfsDepthFor(config: PuzzleConfig): number {
	return Math.max(
		12,
		config.templates.length + (config.minMovesToSolve ?? config.templates.length) + 2
	);
}

function now(): number {
	return performance.now();
}

interface Row {
	packSlug: string;
	puzzleId: number;
	bfsMoves: number | null;
	bfsMs: number;
	algebraicMoves: number | null;
	algebraicNullity: number | null;
	algebraicMs: number;
}

function main() {
	const slugs = parseSlugs();
	const rows: Row[] = [];
	const missing: string[] = [];

	for (const slug of slugs) {
		const pack = getPackBySlug(slug);
		if (!pack) {
			missing.push(slug);
			continue;
		}

		for (const [idStr, config] of Object.entries(pack.puzzles)) {
			const puzzleId = Number(idStr);
			const depth = bfsDepthFor(config);

			const bfsStart = now();
			const bfsMoves = solveMinMoves(config, depth);
			const bfsMs = now() - bfsStart;

			const algStart = now();
			const algebraic = solveMinMovesAlgebraic(config);
			const algebraicMs = now() - algStart;

			rows.push({
				packSlug: slug,
				puzzleId,
				bfsMoves,
				bfsMs,
				algebraicMoves: algebraic?.minMoves ?? null,
				algebraicNullity: algebraic?.nullity ?? null,
				algebraicMs
			});
		}
	}

	if (missing.length > 0) {
		console.log(`Skipped unknown pack slug(s): ${missing.join(', ')}\n`);
	}

	const mismatches = rows.filter(
		(r) => r.algebraicMoves !== null && r.bfsMoves !== null && r.algebraicMoves !== r.bfsMoves
	);
	const skipped = rows.filter((r) => r.algebraicMoves === null);
	const computed = rows.filter((r) => r.algebraicMoves !== null);

	console.log(`Validated ${rows.length} puzzle(s) across ${slugs.length - missing.length} pack(s)\n`);

	if (mismatches.length > 0) {
		console.log(`❌ MISMATCHES (${mismatches.length}) — algebraic result disagrees with BFS:\n`);
		for (const row of mismatches) {
			console.log(
				`  ${row.packSlug} #${row.puzzleId}: BFS=${row.bfsMoves} algebraic=${row.algebraicMoves} (nullity=${row.algebraicNullity})`
			);
		}
		console.log();
	} else {
		console.log(`✅ No mismatches — algebraic result matches BFS on all ${computed.length} computed puzzle(s).\n`);
	}

	if (skipped.length > 0) {
		console.log(`Skipped by algebraic solver (unsolvable under move set, or nullity too large): ${skipped.length}`);
		for (const row of skipped) {
			const bfsNote = row.bfsMoves === null ? 'BFS also found no solution' : `BFS found ${row.bfsMoves}`;
			console.log(`  ${row.packSlug} #${row.puzzleId}: ${bfsNote}`);
		}
		console.log();
	}

	const totalBfsMs = rows.reduce((sum, r) => sum + r.bfsMs, 0);
	const totalAlgebraicMs = computed.reduce((sum, r) => sum + r.algebraicMs, 0);
	const bfsMsOnComputed = computed.reduce((sum, r) => sum + r.bfsMs, 0);

	console.log('--- Timing ---');
	console.log(`Total BFS time (all ${rows.length} puzzles):            ${totalBfsMs.toFixed(1)}ms`);
	console.log(`Total algebraic time (${computed.length} puzzles it handled):   ${totalAlgebraicMs.toFixed(1)}ms`);
	console.log(`BFS time on that same ${computed.length}-puzzle subset:         ${bfsMsOnComputed.toFixed(1)}ms`);
	if (totalAlgebraicMs > 0) {
		console.log(`Speedup on that subset:                        ${(bfsMsOnComputed / totalAlgebraicMs).toFixed(1)}x`);
	}

	const slowestBfs = [...rows].sort((a, b) => b.bfsMs - a.bfsMs).slice(0, 5);
	console.log('\nSlowest BFS solves (worst case for the current approach):');
	for (const row of slowestBfs) {
		console.log(
			`  ${row.packSlug} #${row.puzzleId}: BFS=${row.bfsMs.toFixed(2)}ms  algebraic=${row.algebraicMs.toFixed(3)}ms  (nullity=${row.algebraicNullity ?? 'n/a'})`
		);
	}

	if (mismatches.length > 0) {
		process.exit(1);
	}
}

main();
