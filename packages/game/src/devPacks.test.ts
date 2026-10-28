import { describe, it, expect } from 'vitest';
import { DEV_PACK_SLUGS, isDevPack } from './devPacks.js';

describe('devPacks', () => {
	it('lists the packs used for local dev seeding', () => {
		expect(DEV_PACK_SLUGS).toEqual([
			'first-steps',
			'chromatic-ascent',
			'color-ladder',
			'grid-4x4-dev',
			'simple-mono-dev',
			'monochrome',
			'multicolor',
			'playtest-colors-dev'
		]);
	});

	it('recognises dev pack slugs', () => {
		expect(isDevPack('first-steps')).toBe(true);
		expect(isDevPack('chromatic-ascent')).toBe(true);
		expect(isDevPack('color-ladder')).toBe(true);
		expect(isDevPack('grid-4x4-dev')).toBe(true);
		expect(isDevPack('simple-mono-dev')).toBe(true);
		expect(isDevPack('monochrome')).toBe(true);
		expect(isDevPack('multicolor')).toBe(true);
		expect(isDevPack('playtest-colors-dev')).toBe(true);
	});

	it('rejects non-dev pack slugs', () => {
		expect(isDevPack('intro-pack')).toBe(false);
		expect(isDevPack('tutorial-auto')).toBe(false);
	});
});
