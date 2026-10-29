import type { PuzzleConfig } from '@flip/game';
import { PIGMENT_CLEAR_SOLVED_VALUE } from '@flip/game';

/**
 * Tutorial: one 3×3 lens, two moves. The first move uses the lens as dealt;
 * the second needs it rotated 90° clockwise (one tap on the selected lens).
 * The two orientations cover disjoint cells, so each move only clears colour.
 */
export const TUTORIAL_PUZZLE_CONFIG: PuzzleConfig = {
  startState: [
    [1, 1, 1],
    [1, 0, 0],
    [0, 0, 0]
  ],
  templates: [
    {
      shape: [
        [1, 0, 0],
        [1, 0, 0],
        [0, 0, 0]
      ]
    }
  ],
  solvedValue: PIGMENT_CLEAR_SOLVED_VALUE,
  minMovesToSolve: 2
};
