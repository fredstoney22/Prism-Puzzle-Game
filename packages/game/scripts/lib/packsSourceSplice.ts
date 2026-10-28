/**
 * Splices a single pack's `{...}` object into packs.ts's raw source text in
 * place, instead of `JSON.stringify`-ing and rewriting the whole `packs` array.
 *
 * Why: packs.ts mixes hand-authored TS object-literal style (`slug: 'foo'`) with
 * JSON.stringify output (`"slug": "foo"`) from past generator runs, and some
 * packs (e.g. `simpleMonoDevPack`) are spliced in live via an imported variable
 * rather than an inline object. A full-array `JSON.stringify` rewrite flattens
 * those live references into static JSON — an unwanted structural change to
 * packs nobody asked to touch. Splicing only the target pack's block leaves
 * every other byte in the file untouched, live imports included.
 */
import type { PackDefinition } from '../../src/types.js';

const ARRAY_START_MARKER = 'export const packs: PackDefinition[] = [';

/** Matches the pack's slug in either quoting style the file may currently use. */
function findSlugMarkerIndex(content: string, slug: string): number {
	const candidates = [`slug: '${slug}'`, `"slug": "${slug}"`, `slug: "${slug}"`];
	for (const marker of candidates) {
		const index = content.indexOf(marker);
		if (index !== -1) return index;
	}
	return -1;
}

/** Finds the `{...}` block for an existing pack by slug. Null if the slug isn't present yet. */
export function findPackBlock(content: string, slug: string): { start: number; end: number } | null {
	const markerIndex = findSlugMarkerIndex(content, slug);
	if (markerIndex === -1) return null;

	const start = content.lastIndexOf('{', markerIndex);
	if (start === -1) {
		throw new Error(`Could not find opening brace before slug "${slug}"`);
	}

	let depth = 0;
	let end = -1;
	for (let i = start; i < content.length; i++) {
		if (content[i] === '{') depth++;
		else if (content[i] === '}') {
			depth--;
			if (depth === 0) {
				end = i + 1;
				break;
			}
		}
	}
	if (end === -1) {
		throw new Error(`Could not find matching closing brace for "${slug}" pack block`);
	}
	return { start, end };
}

/** Index of the `]` closing `export const packs: PackDefinition[] = [ ... ]`. */
function findArrayEnd(content: string): number {
	const arrayStart = content.indexOf(ARRAY_START_MARKER);
	if (arrayStart === -1) {
		throw new Error(`Could not find "${ARRAY_START_MARKER}" in packs.ts`);
	}

	const bracketStart = arrayStart + ARRAY_START_MARKER.length - 1; // index of '['
	let depth = 0;
	for (let i = bracketStart; i < content.length; i++) {
		if (content[i] === '[') depth++;
		else if (content[i] === ']') {
			depth--;
			if (depth === 0) return i;
		}
	}
	throw new Error('Could not find matching closing bracket for packs array');
}

function serializeAtIndent(pack: PackDefinition, indent: string): string {
	return JSON.stringify(pack, null, 2)
		.split('\n')
		.map((line, i) => (i === 0 ? line : indent + line))
		.join('\n');
}

/** Replaces an existing pack's `{...}` block with newly generated content, in place. */
function replaceBlock(
	content: string,
	block: { start: number; end: number },
	pack: PackDefinition
): string {
	const baseIndent = content.slice(0, block.start).split('\n').pop() ?? '';
	const serialized = serializeAtIndent(pack, baseIndent);
	return content.slice(0, block.start) + serialized + content.slice(block.end);
}

/** Appends a new pack as the array's last element, matching the array's top-level indent. */
function appendBlock(content: string, pack: PackDefinition): string {
	const arrayEndIndex = findArrayEnd(content);

	let i = arrayEndIndex - 1;
	while (i >= 0 && /\s/.test(content[i])) i--;
	if (content[i] !== '}') {
		throw new Error('Expected the packs array to end with a pack object before appending');
	}
	const insertAt = i + 1;

	// One tab in from the array's own indent (0) — matches every existing top-level pack entry.
	// No trailing newline in the insertion — content.slice(insertAt) already starts with the
	// newline that preceded the array's closing bracket.
	const serialized = serializeAtIndent(pack, '\t');
	const insertion = `,\n\t${serialized}`;
	return content.slice(0, insertAt) + insertion + content.slice(insertAt);
}

/**
 * Replaces `slug`'s block if present, otherwise appends `pack` as a new array
 * element. Every other byte of `content` — formatting, live-imported packs,
 * comments — is left untouched.
 */
export function spliceOrAppendPack(content: string, slug: string, pack: PackDefinition): string {
	const block = findPackBlock(content, slug);
	return block ? replaceBlock(content, block, pack) : appendBlock(content, pack);
}
