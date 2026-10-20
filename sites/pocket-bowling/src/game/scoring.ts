import type { FrameData } from '../types';

export interface ScoreCard {
  frameScores: Array<number | null>;
  cumulative: Array<number | null>;
  total: number | null;
}

export function isFrameComplete(frame: FrameData, index: number): boolean {
  const [a = 0, b = 0] = frame.rolls;
  if (index < 9) return a === 10 || frame.rolls.length >= 2;
  if (a === 10 || a + b === 10) return frame.rolls.length >= 3;
  return frame.rolls.length >= 2;
}

export function scoreFrames(frames: FrameData[]): ScoreCard {
  const rolls = frames.flatMap((frame) => frame.rolls);
  const frameScores: Array<number | null> = Array(10).fill(null);
  const cumulative: Array<number | null> = Array(10).fill(null);
  let rollIndex = 0;
  let running = 0;

  for (let frameIndex = 0; frameIndex < 10; frameIndex += 1) {
    const frame = frames[frameIndex];
    if (!frame || !isFrameComplete(frame, frameIndex)) break;

    const first = rolls[rollIndex] ?? 0;
    let score: number | null = null;

    if (frameIndex === 9) {
      score = frame.rolls.reduce((sum, roll) => sum + roll, 0);
      rollIndex += frame.rolls.length;
    } else if (first === 10) {
      if (rolls[rollIndex + 1] === undefined || rolls[rollIndex + 2] === undefined) break;
      score = 10 + (rolls[rollIndex + 1] ?? 0) + (rolls[rollIndex + 2] ?? 0);
      rollIndex += 1;
    } else {
      const second = rolls[rollIndex + 1];
      if (second === undefined) break;
      if (first + second === 10) {
        if (rolls[rollIndex + 2] === undefined) break;
        score = 10 + (rolls[rollIndex + 2] ?? 0);
      } else {
        score = first + second;
      }
      rollIndex += 2;
    }

    frameScores[frameIndex] = score;
    running += score;
    cumulative[frameIndex] = running;
  }

  return {
    frameScores,
    cumulative,
    total: cumulative[9] ?? null,
  };
}

export function rollMarks(frame: FrameData, frameIndex: number): string[] {
  const mark = (value: number) => (value === 0 ? '–' : String(value));
  const rolls = frame.rolls;
  if (frameIndex < 9) {
    if (rolls[0] === 10) return ['X'];
    const output = rolls.length > 0 ? [mark(rolls[0] ?? 0)] : [];
    if (rolls.length > 1) output.push((rolls[0] ?? 0) + (rolls[1] ?? 0) === 10 ? '/' : mark(rolls[1] ?? 0));
    return output;
  }

  const output: string[] = [];
  if (rolls[0] !== undefined) output.push(rolls[0] === 10 ? 'X' : mark(rolls[0]));
  if (rolls[1] !== undefined) {
    if (rolls[1] === 10) output.push('X');
    else if ((rolls[0] ?? 0) < 10 && (rolls[0] ?? 0) + rolls[1] === 10) output.push('/');
    else output.push(mark(rolls[1]));
  }
  if (rolls[2] !== undefined) {
    const secondWasStrike = rolls[1] === 10;
    output.push(rolls[2] === 10 ? 'X' : (!secondWasStrike && (rolls[1] ?? 0) + rolls[2] === 10 ? '/' : mark(rolls[2])));
  }
  return output;
}

export function createEmptyFrames(): FrameData[] {
  return Array.from({ length: 10 }, () => ({ rolls: [] }));
}
