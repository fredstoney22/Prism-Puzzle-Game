import { describe, expect, it } from 'vitest';

import { packs } from '../packs.js';
import { applyTemplate, isSolved } from '../PuzzleFunctions.js';
import { orientTemplate } from '../templatePigment.js';
import type { Pigment, PuzzleConfig, PuzzleGrid, PuzzleTemplate } from '../types.js';
import {
	NotThreeByThreeError,
	configToVec,
	dirtyCells,
	gridToVec,
	isSolvedVec,
	placementsFor,
	popcount,
	rotateVec,
	vecToConfig,
	vecToGrid
} from './bitboard.js';

const TRIALS = 500;

/** Small seeded PRNG so property tests are reproducible. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randomPigment(rand: () => number): Pigment {
	return Math.floor(rand() * 8) as Pigment;
}

function randomGrid(rand: () => number): PuzzleGrid {
	return [0, 1, 2].map(() => [0, 1, 2].map(() => randomPigment(rand)));
}

function randomConfig(rand: () => number): PuzzleConfig {
	const lensCount = 1 + Math.floor(rand() * 3);
	const templates: PuzzleTemplate[] = [];
	for (let i = 0; i < lensCount; i++) templates.push({ shape: randomGrid(rand) });
	const config: PuzzleConfig = {
		startState: randomGrid(rand),
		templates,
		solvedValue: rand() < 0.8 ? 0 : 1
	};
	if (rand() < 0.5) config.minMovesToSolve = 2 + Math.floor(rand() * 5);
	return config;
}

describe('engine3x3/bitboard', () => {
	it('encodes a cell pigment into its three bit layers', () => {
		const grid: PuzzleGrid = [
			[7, 0, 0],
			[0, 0, 0],
			[0, 0, 0]
		];
		expect(gridToVec(grid)).toBe((1 << 0) | (1 << 9) | (1 << 18));
	});

	it('round-trips random grids through Vec', () => {
		const rand = mulberry32(1);
		for (let i = 0; i < TRIALS; i++) {
			const grid = randomGrid(rand);
			expect(vecToGrid(gridToVec(grid))).toEqual(grid);
		}
	});

	it('rotateVec matches orientTemplate for every rotation count', () => {
		const rand = mulberry32(2);
		for (let i = 0; i < TRIALS; i++) {
			const template: PuzzleTemplate = { shape: randomGrid(rand) };
			let vec = gridToVec(template.shape);
			for (let rot = 0; rot < 4; rot++) {
				expect(vecToGrid(vec)).toEqual(orientTemplate(template, rot).shape);
				vec = rotateVec(vec);
			}
			expect(vec).toBe(gridToVec(template.shape));
		}
	});

	it('applying a placement via XOR equals production applyTemplate', () => {
		const rand = mulberry32(3);
		for (let i = 0; i < TRIALS; i++) {
			const config = randomConfig(rand);
			const start = gridToVec(config.startState);
			for (const placement of placementsFor(config.templates.map((t) => gridToVec(t.shape)))) {
				const template = orientTemplate(config.templates[placement.lens], placement.rotation);
				const expected = applyTemplate(config.startState, template, 0, 0);
				expect(vecToGrid(start ^ placement.vec)).toEqual(expected);
			}
		}
	});

	it('placementsFor yields one placement per distinct orientation of each lens', () => {
		const lShape: PuzzleGrid = [
			[1, 0, 0],
			[1, 0, 0],
			[1, 1, 0]
		];
		const plus: PuzzleGrid = [
			[0, 2, 0],
			[2, 2, 2],
			[0, 2, 0]
		];
		const bar: PuzzleGrid = [
			[0, 0, 0],
			[4, 4, 4],
			[0, 0, 0]
		];
		const placements = placementsFor([lShape, plus, bar].map(gridToVec));
		expect(placements.map((p) => [p.lens, p.rotation])).toEqual([
			[0, 0],
			[0, 1],
			[0, 2],
			[0, 3],
			[1, 0],
			[2, 0],
			[2, 1]
		]);
	});

	it('placementsFor skips empty lenses', () => {
		expect(placementsFor([0])).toEqual([]);
	});

	it('isSolvedVec agrees with production isSolved on random grids', () => {
		const rand = mulberry32(4);
		for (let i = 0; i < TRIALS * 4; i++) {
			// Bias towards uniform grids so the "solved" branch is exercised.
			const uniform = rand() < 0.3;
			const fill = randomPigment(rand);
			const grid = uniform ? [0, 1, 2].map(() => [fill, fill, fill]) : randomGrid(rand);
			const solvedValue = randomPigment(rand);
			expect(isSolvedVec(gridToVec(grid), solvedValue)).toBe(isSolved(grid, solvedValue));
		}
		expect(isSolvedVec(0)).toBe(true);
	});

	it('popcount and dirtyCells count bits and non-clear cells', () => {
		expect(popcount(0)).toBe(0);
		expect(popcount(0x7ffffff)).toBe(27);
		const grid: PuzzleGrid = [
			[1, 0, 2],
			[0, 4, 0],
			[0, 0, 7]
		];
		expect(dirtyCells(gridToVec(grid))).toBe(0b100010101);
	});

	it('round-trips random 3x3 PuzzleConfigs through Vec unchanged', () => {
		const rand = mulberry32(5);
		for (let i = 0; i < TRIALS; i++) {
			const config = randomConfig(rand);
			expect(vecToConfig(configToVec(config))).toStrictEqual(config);
		}
	});

	it('round-trips every shipped 3x3-board / 3x3-lens puzzle unchanged', () => {
		const is3x3 = (g: PuzzleGrid) => g.length === 3 && g.every((row) => row.length === 3);
		const shipped = packs
			.flatMap((pack) => Object.values(pack.puzzles))
			.filter((c) => is3x3(c.startState) && c.templates.every((t) => is3x3(t.shape)));
		expect(shipped.length).toBeGreaterThan(0);
		for (const config of shipped) {
			expect(vecToConfig(configToVec(config))).toStrictEqual(config);
		}
	});

	it('rejects configs that are not 3x3 board with 3x3 lenses', () => {
		const board: PuzzleGrid = [
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1]
		];
		const smallLens: PuzzleTemplate = {
			shape: [
				[1, 1],
				[1, 1]
			]
		};
		expect(() =>
			configToVec({ startState: board, templates: [smallLens], solvedValue: 0 })
		).toThrow(NotThreeByThreeError);
		expect(() =>
			configToVec({ startState: [[1, 0, 0, 0]], templates: [], solvedValue: 0 })
		).toThrow(NotThreeByThreeError);
	});
});
