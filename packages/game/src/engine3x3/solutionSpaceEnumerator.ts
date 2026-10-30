/**
 * Gray-code walk over all subsets of a lens set's distinct moves, producing the
 * solution space table (docs/generation-engine-overhaul.md §2). Each step flips
 * one move, so it costs one XOR and one popcount. At most 12 moves (3 lenses ×
 * 4 rotations) means at most 4,096 steps.
 */

import { placementsFor, popcount, type Placement, type Vec } from './bitboard.js';
import { SolutionSpaceTable, type SolutionEntry, type SolutionMove } from './solutionSpaceTable.js';

type PlacementSource = (lenses: Vec[]) => Placement[];

/** Collapses placements that share a vec: applying one twice cancels, so one move per vec. */
function distinctMoves(placements: Placement[]): SolutionMove[] {
	const byVec = new Map<Vec, SolutionMove>();
	for (const { lens, rotation, vec } of placements) {
		const existing = byVec.get(vec);
		if (!existing) {
			byVec.set(vec, { lens, rotation, lenses: [lens], vec });
		} else if (!existing.lenses.includes(lens)) {
			existing.lenses.push(lens);
		}
	}
	return [...byVec.values()];
}

export class SolutionSpaceEnumerator {
	constructor(private readonly placementSource: PlacementSource = placementsFor) {}

	enumerate(lenses: Vec[]): SolutionSpaceTable {
		const moves = distinctMoves(this.placementSource(lenses));
		const entries = new Map<Vec, SolutionEntry>();
		const total = 2 ** moves.length;

		let mask = 0;
		let delta = 0;
		for (let step = 0; step < total; step++) {
			if (step > 0) {
				const bit = 31 - Math.clz32(step & -step);
				mask ^= 1 << bit;
				delta ^= moves[bit].vec;
			}
			this.record(entries, delta, mask);
		}
		return new SolutionSpaceTable(moves, entries);
	}

	private record(entries: Map<Vec, SolutionEntry>, delta: Vec, mask: number): void {
		const size = popcount(mask);
		const entry = entries.get(delta);
		if (!entry) {
			entries.set(delta, {
				minMoves: size,
				minSetCount: 1,
				totalSetCount: 1,
				witnessMask: mask
			});
			return;
		}
		entry.totalSetCount++;
		if (size < entry.minMoves) {
			entry.minMoves = size;
			entry.minSetCount = 1;
			entry.witnessMask = mask;
		} else if (size === entry.minMoves) {
			entry.minSetCount++;
			if (mask < entry.witnessMask) entry.witnessMask = mask;
		}
	}
}
