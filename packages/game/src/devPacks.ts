/**
 * Packs that stay active when seeding locally with the default dev mode.
 *
 * All packs still live in packs.ts for vetting and CI. Packs not listed here
 * are stored as `active: false` (archived) when SEED_ACTIVE_MODE=dev.
 *
 * To work on another pack locally: add its slug here, re-run `npm run db:seed`.
 */
export const DEV_PACK_SLUGS = [
	'first-steps',
	'chromatic-ascent',
	'color-ladder',
	'grid-4x4-dev',
	'simple-mono-dev',
	'monochrome',
	'multicolor',
	'playtest-colors-dev'
] as const;

export type DevPackSlug = (typeof DEV_PACK_SLUGS)[number];

export function isDevPack(slug: string): slug is DevPackSlug {
	return (DEV_PACK_SLUGS as readonly string[]).includes(slug);
}
