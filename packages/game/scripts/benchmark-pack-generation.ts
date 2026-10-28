/**
 * Spike benchmark: time today's generation paths for a 10-puzzle 3×3 pack, and a
 * throwaway prototype of the proposed exhaustive 3×3 engine
 * (docs/generation-engine-overhaul.md). Read-only: never writes packs.ts.
 *
 * Run from app-template:
 *   npx tsx packages/game/scripts/benchmark-pack-generation.ts
 *   npx tsx packages/game/scripts/benchmark-pack-generation.ts --only=pool-mono,prototype
 *   npx tsx packages/game/scripts/benchmark-pack-generation.ts --runs=3
 *
 * Benchmarks (ids for --only):
 *   pool-mono     generatePackFromPoolSpec, `monochrome` pool spec scaled to 10 puzzles / 30 candidates
 *   pool-color    generatePackFromPoolSpec, `multicolor` pool spec scaled to 10 puzzles / 30 candidates
 *   pool-color-split  same as pool-color, timing candidate pool vs assemble (forgiveness enrichment)
 *   slot-ladder   generatePackDefinition on the `color-ladder` slot spec (10 slots, 3×3)
 *   simple        generateSimplePuzzle ×10 (generate-simple-dev-pack.ts config)
 *   daily         generateDailyPuzzle ×10 (alternating mono / color)
 *   prototype     exhaustive GF(2) subset enumeration prototype (mono + color packs of 10)
 *   audit         prototype metrics over shipped 3×3/3×3-lens puzzles (monochrome, multicolor, first-steps)
 */
import { generateDailyPuzzle } from '../src/dailyGeneration.js';
import { generatePackDefinition } from '../src/packGeneration.js';
import { getPackGenerationSpec } from '../src/packGenerationSpecs.js';
import {
	assemblePackFromPool,
	generatePackCandidatePool,
	generatePackFromPoolSpec
} from '../src/packPoolGeneration.js';
import { generateSimplePuzzle, type SimplePackConfig } from '../src/simplePuzzleGeneration.js';
import type { PackGenerationSpec } from '../src/packGenerationTypes.js';
import { getPackBySlug } from '../src/packs.js';
import type { Pigment } from '../src/types.js';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const ALL_IDS = [
	'pool-mono',
	'pool-color',
	'pool-color-split',
	'slot-ladder',
	'simple',
	'daily',
	'prototype',
	'audit'
] as const;
type BenchId = (typeof ALL_IDS)[number];

function parseArgs(): { only: BenchId[]; runs: number } {
	const onlyArg = process.argv.find((a) => a.startsWith('--only='));
	const runsArg = process.argv.find((a) => a.startsWith('--runs='));
	const only = onlyArg ? (onlyArg.slice('--only='.length).split(',') as BenchId[]) : [...ALL_IDS];
	const runs = runsArg ? Math.max(1, Number(runsArg.slice('--runs='.length))) : 1;
	return { only, runs };
}

function time<T>(fn: () => T): { ms: number; value: T } {
	const start = performance.now();
	const value = fn();
	return { ms: performance.now() - start, value };
}

function fmt(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`;
}

// ─── Baselines (existing production code paths) ───────────────────────────────

function scaledPoolSpec(slug: string): PackGenerationSpec {
	const spec = getPackGenerationSpec(slug);
	if (!spec?.pool) throw new Error(`No pool spec for ${slug}`);
	// Same 3× candidate ratio production uses (50 puzzles / 150 candidates).
	return { ...spec, pool: { ...spec.pool, puzzleCount: 10, candidatesPerPack: 30 } };
}

const SIMPLE_CONFIG: SimplePackConfig = {
	puzzleSize: 3,
	templateSize: 3,
	minTemplates: 3,
	maxTemplates: 3,
	minMoveCount: 3,
	maxMoveCount: 3,
	allowedPigments: [1],
	requireMulticolorTemplate: false,
	requireEachTemplateUsedAtLeastOnce: true,
	minFilledCells: 3
};

function runPoolColorSplit(): void {
	const spec = scaledPoolSpec('multicolor');
	const pool = spec.pool!;
	const t1 = time(() => generatePackCandidatePool(pool, 'color'));
	const t2 = time(() => assemblePackFromPool(t1.value, pool.puzzleCount));
	const selected = t2.value;
	console.log(
		`  pool-color split: candidates=${t1.value.length} pool=${fmt(t1.ms)} assemble+forgiveness=${fmt(t2.ms)}`
	);
	console.log(
		`    selected minMoves=${selected.map((s) => s.minMovesToSolve).join(',')}` +
			` shortestPathCount=${selected.map((s) => s.difficultyReport?.forgiveness.shortestSolutionCount).join(',')}`
	);
}

function runBaseline(id: Exclude<BenchId, 'prototype' | 'pool-color-split' | 'audit'>): number {
	switch (id) {
		case 'pool-mono':
			return time(() => generatePackFromPoolSpec(scaledPoolSpec('monochrome'))).ms;
		case 'pool-color':
			return time(() => generatePackFromPoolSpec(scaledPoolSpec('multicolor'))).ms;
		case 'slot-ladder': {
			const spec = getPackGenerationSpec('color-ladder');
			if (!spec) throw new Error('color-ladder spec missing');
			return time(() => generatePackDefinition(spec, new Set())).ms;
		}
		case 'simple':
			return time(() => {
				let made = 0;
				while (made < 10) if (generateSimplePuzzle(SIMPLE_CONFIG)) made++;
			}).ms;
		case 'daily':
			return time(() => {
				for (let day = 20_000; day < 20_010; day++) generateDailyPuzzle(day);
			}).ms;
	}
}

// ─── Prototype: exhaustive 3×3 engine core ────────────────────────────────────
//
// On a 3×3 board with 3×3 lenses there is exactly one in-bounds position per
// orientation, so a move is just (lens, rotation): at most 4 per lens. A state is
// a 27-bit vector (3 RYB bit-layers × 9 cells); a move XORs a fixed vector. Moves
// commute and self-cancel, so a solution is a SUBSET of the ≤4k oriented
// placements. Enumerating all 2^|P| subsets once per lens set yields, for every
// reachable start state: exact min moves, number of minimal solution sets, and
// total solution sets — i.e. generation and full verification in one pass.

type Vec = number;
type Lens = Pigment[]; // 9 cells, row-major

function rotateLens(l: Lens): Lens {
	// 90° clockwise: new[r][c] = old[2-c][r]
	const out = new Array<Pigment>(9);
	for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = l[(2 - c) * 3 + r];
	return out;
}

function lensVec(l: Lens): Vec {
	let v = 0;
	for (let i = 0; i < 9; i++) {
		const p = l[i];
		if (p & 1) v |= 1 << i;
		if (p & 2) v |= 1 << (9 + i);
		if (p & 4) v |= 1 << (18 + i);
	}
	return v;
}

function popcount(v: number): number {
	v = v - ((v >>> 1) & 0x55555555);
	v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
	return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Cells (0–8) that are not clear in a 27-bit state. */
function dirtyCells(v: Vec): number {
	return (v | (v >>> 9) | (v >>> 18)) & 0x1ff;
}

interface Placement {
	lens: number;
	rotation: number;
	vec: Vec;
}

function placementsFor(lenses: Lens[]): Placement[] {
	const out: Placement[] = [];
	const seen = new Set<Vec>();
	lenses.forEach((lens, li) => {
		let cur = lens;
		for (let rot = 0; rot < 4; rot++) {
			const v = lensVec(cur);
			if (!seen.has(v)) {
				seen.add(v);
				out.push({ lens: li, rotation: rot, vec: v });
			}
			cur = rotateLens(cur);
		}
	});
	return out;
}

interface StateInfo {
	minMoves: number;
	minSetCount: number;
	totalSetCount: number;
	minSetMask: number; // one minimal subset (bitmask over placements)
}

/** One pass over all 2^|P| subsets (Gray code: one XOR per step). */
function enumerateSolutionSpace(P: Placement[]): Map<Vec, StateInfo> {
	const map = new Map<Vec, StateInfo>();
	const n = P.length;
	let state = 0;
	let mask = 0;
	for (let i = 0; i < 1 << n; i++) {
		if (i > 0) {
			const bit = 31 - Math.clz32(i & -i); // Gray code flips the lowest set bit of i
			state ^= P[bit].vec;
			mask ^= 1 << bit;
		}
		const w = popcount(mask);
		const info = map.get(state);
		if (!info) map.set(state, { minMoves: w, minSetCount: 1, totalSetCount: 1, minSetMask: mask });
		else {
			info.totalSetCount++;
			if (w < info.minMoves) {
				info.minMoves = w;
				info.minSetCount = 1;
				info.minSetMask = mask;
			} else if (w === info.minMoves) info.minSetCount++;
		}
	}
	return map;
}

/**
 * Probability that a "no-thinking" player wins: at each step pick uniformly among
 * moves that strictly reduce the number of non-clear cells; stuck = loss.
 */
function greedySuccessRate(start: Vec, P: Placement[], memo: Map<Vec, number>): number {
	if (start === 0) return 1;
	const cached = memo.get(start);
	if (cached !== undefined) return cached;
	const d = popcount(dirtyCells(start));
	let sum = 0;
	let count = 0;
	for (const p of P) {
		const next = start ^ p.vec;
		if (popcount(dirtyCells(next)) < d) {
			sum += greedySuccessRate(next, P, memo);
			count++;
		}
	}
	const rate = count === 0 ? 0 : sum / count;
	memo.set(start, rate);
	return rate;
}

/** Cells hit by ≥2 placements of the minimal solution (coupling the player must reason about). */
function overlapCells(minSetMask: number, P: Placement[]): number {
	let once = 0;
	let multi = 0;
	for (let i = 0; i < P.length; i++) {
		if (!(minSetMask & (1 << i))) continue;
		const cells = dirtyCells(P[i].vec);
		multi |= once & cells;
		once |= cells;
	}
	return popcount(multi);
}

function randomLens(pigments: Pigment[], minActive: number, maxActive: number): Lens {
	const l: Lens = new Array<Pigment>(9).fill(0);
	const active = minActive + Math.floor(Math.random() * (maxActive - minActive + 1));
	const cells = [...Array(9).keys()].sort(() => Math.random() - 0.5).slice(0, active);
	for (const c of cells) l[c] = pigments[Math.floor(Math.random() * pigments.length)];
	return l;
}

interface ProtoPuzzle {
	start: Vec;
	lensCount: number;
	minMoves: number;
	greedy: number;
	overlap: number;
	nullity: number;
}

interface ProtoOptions {
	pigments: Pigment[];
	requireMultiColorLens: boolean;
	ladder: number[]; // target minMoves per pack slot
}

/**
 * Generate one puzzle at `targetMoves`: sample a lens set, enumerate its whole
 * solution space, pick a start state that passes the non-trivial filters.
 */
function protoGenerate(
	opts: ProtoOptions,
	targetMoves: number,
	seen: Set<string>,
	stats: { lensSets: number }
): ProtoPuzzle | null {
	for (let attempt = 0; attempt < 400; attempt++) {
		const k = targetMoves <= 3 ? 2 + Math.floor(Math.random() * 2) : 3;
		const lenses = Array.from({ length: k }, () => randomLens(opts.pigments, 3, 5));
		if (opts.requireMultiColorLens && !lenses.some((l) => new Set(l.filter((p) => p)).size > 1)) {
			continue;
		}
		const P = placementsFor(lenses);
		stats.lensSets++;
		const space = enumerateSolutionSpace(P);
		const rank = Math.log2(space.size);
		const nullity = P.length - rank;
		const memo = new Map<Vec, number>();
		const candidates: ProtoPuzzle[] = [];
		for (const [start, info] of space) {
			if (info.minMoves !== targetMoves) continue; // exact min moves
			if (info.minSetCount !== 1) continue; // unique minimal solution set
			const usedLenses = new Set(P.filter((_, i) => info.minSetMask & (1 << i)).map((p) => p.lens));
			if (usedLenses.size !== k) continue; // every lens needed
			if (popcount(dirtyCells(start)) < 5) continue; // ≥5 of 9 cells dirty
			const overlap = overlapCells(info.minSetMask, P);
			if (targetMoves >= 3 && overlap < 2) continue; // must reason about overlap
			const greedy = greedySuccessRate(start, P, memo);
			if (greedy > 0.5) continue; // greedy "no-thinking" play must usually fail
			candidates.push({ start, lensCount: k, minMoves: info.minMoves, greedy, overlap, nullity });
		}
		if (candidates.length === 0) continue;
		const pick = candidates[Math.floor(Math.random() * candidates.length)];
		const key = `${pick.start}:${lenses
			.map((l) => l.join(''))
			.sort()
			.join('|')}`;
		if (seen.has(key)) continue;
		seen.add(key);
		return pick;
	}
	return null;
}

function runPrototype(label: string, opts: ProtoOptions): void {
	const stats = { lensSets: 0 };
	const seen = new Set<string>();
	const perPuzzle: number[] = [];
	const results: (ProtoPuzzle | null)[] = [];
	const total = time(() => {
		for (const target of opts.ladder) {
			const t = time(() => protoGenerate(opts, target, seen, stats));
			perPuzzle.push(t.ms);
			results.push(t.value);
		}
	});
	const failed = results.filter((r) => r === null).length;
	const sorted = [...perPuzzle].sort((a, b) => a - b);
	console.log(
		`  ${label.padEnd(26)} pack=${fmt(total.ms).padStart(9)}  per-puzzle median=${fmt(sorted[5])} max=${fmt(sorted[sorted.length - 1])}  lens sets enumerated=${stats.lensSets}  failed slots=${failed}`
	);
	const row = results
		.map((r) => (r ? `${r.minMoves}m/g${r.greedy.toFixed(2)}/o${r.overlap}/n${r.nullity}` : 'FAIL'))
		.join(' ');
	console.log(`    slots (minMoves/greedy-win-rate/overlap-cells/nullity): ${row}`);
}

function runPrototypeSuite(): void {
	const ladder = [2, 2, 3, 3, 3, 4, 4, 4, 5, 5];
	runPrototype('mono (pigment 1)', { pigments: [1], requireMultiColorLens: false, ladder });
	runPrototype('color (R,Y,B; ≥1 multi)', {
		pigments: [1, 2, 4],
		requireMultiColorLens: true,
		ladder
	});

	// Precompute feasibility: enumerate every mono 3×3 lens mask (2^9) into rotation classes.
	const classes = time(() => {
		const seen = new Set<Vec>();
		let count = 0;
		for (let m = 1; m < 512; m++) {
			const l = Array.from({ length: 9 }, (_, i) => ((m >> i) & 1) as Pigment);
			let cur = l;
			let canon = Infinity;
			for (let r = 0; r < 4; r++) {
				canon = Math.min(canon, lensVec(cur));
				cur = rotateLens(cur);
			}
			if (!seen.has(canon)) {
				seen.add(canon);
				count++;
			}
		}
		return count;
	});
	console.log(
		`  mono lens catalog: ${classes.value} rotation classes of non-empty 3×3 masks, built in ${fmt(classes.ms)}`
	);
}

// ─── Audit shipped packs with the prototype metrics ───────────────────────────

function configStartVec(grid: Pigment[][]): Vec {
	return lensVec(grid.flat() as Lens);
}

function runAudit(): void {
	for (const slug of ['first-steps', 'monochrome', 'multicolor']) {
		const pack = getPackBySlug(slug);
		if (!pack) continue;
		let eligible = 0;
		let oneMove = 0;
		let nonUniqueSet = 0;
		let greedyEasy = 0;
		let unusedLens = 0;
		const minMovesHist = new Map<number, number>();
		for (const config of Object.values(pack.puzzles)) {
			const is3x3 =
				config.startState.length === 3 &&
				config.templates.every((t) => t.shape.length === 3 && t.shape[0].length === 3);
			if (!is3x3) continue;
			eligible++;
			const lenses = config.templates.map((t) => t.shape.flat() as Lens);
			const P = placementsFor(lenses);
			const info = enumerateSolutionSpace(P).get(configStartVec(config.startState));
			if (!info) continue;
			minMovesHist.set(info.minMoves, (minMovesHist.get(info.minMoves) ?? 0) + 1);
			if (info.minMoves <= 1) oneMove++;
			if (info.minSetCount > 1) nonUniqueSet++;
			const used = new Set(P.filter((_, i) => info.minSetMask & (1 << i)).map((p) => p.lens));
			if (used.size < lenses.length) unusedLens++;
			if (greedySuccessRate(configStartVec(config.startState), P, new Map()) > 0.5) greedyEasy++;
		}
		const hist = [...minMovesHist.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([m, c]) => `${m}:${c}`)
			.join(' ');
		console.log(
			`  ${slug.padEnd(12)} 3×3-lens puzzles=${eligible}  minMoves hist {${hist}}  ` +
				`minMoves≤1=${oneMove}  non-unique min set=${nonUniqueSet}  ` +
				`lens unused in min set=${unusedLens}  greedy win >50%=${greedyEasy}`
		);
	}
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
	const { only, runs } = parseArgs();
	console.log(`Node ${process.version} — ${runs} run(s) per benchmark\n`);
	for (const id of only) {
		if (id === 'audit') {
			console.log('audit (prototype metrics over shipped packs):');
			runAudit();
			continue;
		}
		if (id === 'pool-color-split') {
			for (let r = 0; r < runs; r++) runPoolColorSplit();
			continue;
		}
		if (id === 'prototype') {
			console.log('prototype (exhaustive 3×3, not production code):');
			for (let r = 0; r < runs; r++) runPrototypeSuite();
			continue;
		}
		const times: number[] = [];
		for (let r = 0; r < runs; r++) {
			try {
				times.push(runBaseline(id));
			} catch (error) {
				console.log(`  ${id}: FAILED — ${(error as Error).message}`);
			}
		}
		if (times.length > 0) {
			console.log(`${id.padEnd(12)} 10 puzzles: ${times.map(fmt).join(', ')}`);
		}
	}
}

main();
