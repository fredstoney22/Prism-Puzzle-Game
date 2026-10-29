/**
 * Per-puzzle exemptions from individual `game:validate` rules.
 *
 * An exemption covers one rule on one puzzle and must state why the "violation"
 * is deliberate. Exemptions are declared next to the puzzle data they cover and
 * collected here; rules are never disabled globally.
 */

import { COLOR_LADDER_VALIDATION_EXEMPTIONS } from './packGenerationSpecs.js';
import { FIRST_STEPS_VALIDATION_EXEMPTIONS } from './puzzles/firstSteps.js';

export type ValidationRuleId =
	| 'min-template-active-cells'
	| 'template-containment'
	| 'multi-pigment-template-count';

export interface PuzzleValidationExemption {
	packSlug: string;
	puzzleId: number;
	rule: ValidationRuleId;
	/** Why this puzzle deliberately breaks the rule. Required. */
	reason: string;
}

export class ValidationExemptions {
	constructor(private readonly exemptions: readonly PuzzleValidationExemption[]) {
		for (const exemption of exemptions) {
			if (exemption.reason.trim() === '') {
				throw new Error(
					`Exemption for ${exemption.packSlug} #${exemption.puzzleId} (${exemption.rule}) needs a reason`
				);
			}
		}
	}

	find(
		packSlug: string,
		puzzleId: number,
		rule: ValidationRuleId
	): PuzzleValidationExemption | undefined {
		return this.exemptions.find(
			(e) => e.packSlug === packSlug && e.puzzleId === puzzleId && e.rule === rule
		);
	}
}

export const PACK_VALIDATION_EXEMPTIONS: readonly PuzzleValidationExemption[] = [
	...FIRST_STEPS_VALIDATION_EXEMPTIONS,
	...COLOR_LADDER_VALIDATION_EXEMPTIONS
];
