/**
 * Spike: report GF(2) move-matrix nullity for existing color packs.
 *
 * Purpose: sanity-check the premise that pool-generated color puzzles have small
 * nullity (few "quiet patterns"), which would make an exact kernel-search min-move
 * solver (particular solution + brute-force over the 2^nullity kernel combinations)
 * tractable as a BFS replacement. If nullity is routinely large here, that approach
 * doesn't pay off and the bottleneck needs a different fix (bidirectional BFS,
 * parallelism, caching, etc).
 *
 * Run from app-template:
 *   npx tsx packages/game/scripts/report-pack-nullity.ts
 *   npx tsx packages/game/scripts/report-pack-nullity.ts --slug=multicolor,color-ladder
 */
import { getPackBySlug } from '../src/packs.js';
import { analyzeSolvability } from '../src/puzzleSolvability.js';

const DEFAULT_SLUGS = [
	'multicolor',
	'color-ladder',
	'color-spectrum',
	'chromatic-ascent',
	'color-lab'
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

interface Row {
	packSlug: string;
	puzzleId: number;
	placementCount: number;
	rank: number;
	nullity: number;
	quietPatternCount: number;
	isStartSolvable: boolean;
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
			const report = analyzeSolvability(config);
			rows.push({
				packSlug: slug,
				puzzleId,
				placementCount: report.placementCount,
				rank: report.rank,
				nullity: report.nullity,
				quietPatternCount: report.quietPatternCount,
				isStartSolvable: report.isStartSolvable
			});
		}
	}

	if (missing.length > 0) {
		console.log(`Skipped unknown pack slug(s): ${missing.join(', ')}\n`);
	}

	if (rows.length === 0) {
		console.log('No puzzles found for the given slugs.');
		process.exit(1);
	}

	console.log(`Analyzed ${rows.length} puzzle(s) across ${slugs.length - missing.length} pack(s)\n`);

	console.log(
		'Pack'.padEnd(18) +
			'ID'.padStart(4) +
			'M(placements)'.padStart(15) +
			'Rank'.padStart(7) +
			'Nullity'.padStart(9) +
			'2^nullity'.padStart(11) +
			'Solvable'.padStart(10)
	);
	console.log('-'.repeat(74));

	for (const row of rows.sort((a, b) =>
		a.packSlug === b.packSlug ? a.puzzleId - b.puzzleId : a.packSlug.localeCompare(b.packSlug)
	)) {
		console.log(
			row.packSlug.padEnd(18) +
				String(row.puzzleId).padStart(4) +
				String(row.placementCount).padStart(15) +
				String(row.rank).padStart(7) +
				String(row.nullity).padStart(9) +
				String(row.quietPatternCount).padStart(11) +
				(row.isStartSolvable ? 'yes' : 'NO').padStart(10)
		);
	}

	const nullities = rows.map((r) => r.nullity);
	const unsolvable = rows.filter((r) => !r.isStartSolvable);
	const histogram = new Map<number, number>();
	for (const n of nullities) {
		histogram.set(n, (histogram.get(n) ?? 0) + 1);
	}

	console.log('\n--- Nullity distribution ---');
	for (const nullity of [...histogram.keys()].sort((a, b) => a - b)) {
		const count = histogram.get(nullity)!;
		const bar = '#'.repeat(count);
		console.log(`nullity=${String(nullity).padStart(3)}  (2^n=${String(2 ** nullity).padStart(6)})  ${String(count).padStart(4)}  ${bar}`);
	}

	const min = Math.min(...nullities);
	const max = Math.max(...nullities);
	const avg = nullities.reduce((sum, n) => sum + n, 0) / nullities.length;

	console.log(
		`\nnullity: min=${min} max=${max} avg=${avg.toFixed(2)}` +
			(unsolvable.length > 0
				? `  |  WARNING: ${unsolvable.length} puzzle(s) reported not solvable by analyzeSolvability`
				: '')
	);

	if (max <= 20) {
		console.log(
			`\nAll puzzles have nullity <= 20 (2^${max} = ${2 ** max} kernel combinations) — ` +
				`exact kernel-search min-move solving looks tractable for this corpus.`
		);
	} else {
		console.log(
			`\nAt least one puzzle has nullity > 20 (2^${max} = ${(2 ** max).toExponential(2)} combinations) — ` +
				`kernel search alone won't be cheap for that puzzle; would need a fallback (bidirectional BFS, ` +
				`meet-in-the-middle over the kernel, or a nullity cap as a generation-time reject filter).`
		);
	}
}

main();
