/**
 * Tutorial step types; shared by the tutorial page, registry, and TutorialWalkthrough.
 */
export type StepAction = 'start' | 'next' | 'wait' | 'finish' | 'info';

/** Puzzle events that can advance a `wait` step when listed in `advanceOn`. */
export type TutorialAdvanceTrigger =
	| 'templateSelect'
	| 'move'
	| 'templateRotate'
	| 'solve';

export interface TutorialStep {
	title: string;
	body: string;
	/**
	 * What button(s) to show.
	 * `wait` = user must perform the action described.
	 * `info` = title and body only — no buttons or step counter; advances on first puzzle interaction.
	 */
	action: StepAction;
	/** For `wait` steps: which puzzle event advances to the next step. */
	advanceOn?: TutorialAdvanceTrigger;
	/** For `advanceOn: 'move'`, require this exact move count (optional). */
	moveCount?: number;
	/** For `advanceOn: 'templateSelect'`, require this template index (optional). */
	templateIndex?: number;
	/** For `action: 'finish'` — primary CTA label and destination. */
	finishLabel?: string;
	finishHref?: string;
}

export interface TutorialConfig {
	steps: TutorialStep[];
	/** Shown in the skipped banner and as fallback finish CTA. */
	skippedLinks?: Array<{ label: string; href: string }>;
}

/** Steps that count toward the walkthrough progress indicator. */
export function isInteractiveTutorialStep(step: TutorialStep): boolean {
  return step.action !== 'info';
}

/** Default onboarding tutorial — two moves with a lens rotation. */
export const DEFAULT_TUTORIAL: TutorialConfig = {
  steps: [
    {
      title: 'Welcome to Prism',
      body: 'Clear all the color from the Prism Square. This puzzle takes two moves, and the second one needs the lens rotated.',
      action: 'start'
    },
    {
      title: 'Select the lens',
      body: 'Tap the lens below the Prism Square to select it. The selected lens shows a purple border.',
      action: 'wait',
      advanceOn: 'templateSelect'
    },
    {
      title: 'Apply the first move',
      body: 'Tap anywhere on the Prism Square to apply the lens. That clears some of the colored squares.',
      action: 'wait',
      advanceOn: 'move',
      moveCount: 1
    },
    {
      title: 'Spin the lens',
      body: 'Tap the lens to select it, then tap it again to rotate it 90°. Its pattern now matches the squares that are left.',
      action: 'wait',
      advanceOn: 'templateRotate'
    },
    {
      title: 'Apply the second move',
      body: 'Tap the Prism Square to apply the rotated lens and solve the puzzle.',
      action: 'wait',
      advanceOn: 'solve'
    },
    {
      title: 'You did it!',
      body: 'You solved a two-move puzzle and used a rotation. Try the daily puzzle for a new challenge every day.',
      action: 'finish',
      finishLabel: 'Daily puzzle',
      finishHref: '/daily'
    }
  ],
  skippedLinks: [{ label: 'Daily', href: '/daily' }]
};

/** @deprecated Use DEFAULT_TUTORIAL.steps */
export const TUTORIAL_STEPS = DEFAULT_TUTORIAL.steps;
