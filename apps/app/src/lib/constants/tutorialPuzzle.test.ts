import { describe, expect, it } from 'vitest';
import { applyTemplate, orientTemplate, solveMinMoves } from '@flip/game';
import { TUTORIAL_PUZZLE_CONFIG } from './tutorialPuzzle';

describe('TUTORIAL_PUZZLE_CONFIG', () => {
  const config = TUTORIAL_PUZZLE_CONFIG;

  it('follows the 3×3 tutorial rules: 3×3 board, one 3×3 lens', () => {
    expect(config.startState).toHaveLength(3);
    for (const row of config.startState) expect(row).toHaveLength(3);
    expect(config.templates).toHaveLength(1);
    const [lens] = config.templates;
    expect(lens.shape).toHaveLength(3);
    for (const row of lens.shape) expect(row).toHaveLength(3);
  });

  it('declares exactly the solver minimum of 2 moves', () => {
    expect(config.minMovesToSolve).toBe(2);
    expect(solveMinMoves(config)).toBe(config.minMovesToSolve);
  });

  it('clears the board when the lens is applied unrotated, then after one 90° spin', () => {
    const lens = config.templates[0];
    const afterFirst = applyTemplate(config.startState, orientTemplate(lens, 0), 0, 0);
    expect(afterFirst.flat().every((cell) => cell === config.solvedValue)).toBe(false);
    const afterSecond = applyTemplate(afterFirst, orientTemplate(lens, 1), 0, 0);
    expect(afterSecond.flat().every((cell) => cell === config.solvedValue)).toBe(true);
  });
});
