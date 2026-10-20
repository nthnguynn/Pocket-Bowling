import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/GameSession';
import { createEmptyFrames, scoreFrames } from '../src/game/scoring';

function framesFromRolls(rolls: number[]) {
  const frames = createEmptyFrames();
  let cursor = 0;
  for (let frame = 0; frame < 10; frame += 1) {
    if (frame < 9) {
      const first = rolls[cursor++] ?? 0;
      frames[frame]!.rolls.push(first);
      if (first !== 10) frames[frame]!.rolls.push(rolls[cursor++] ?? 0);
    } else {
      frames[frame]!.rolls.push(...rolls.slice(cursor));
    }
  }
  return frames;
}

describe('tính điểm bowling', () => {
  it('tính ván hoàn hảo là 300', () => {
    expect(scoreFrames(framesFromRolls(Array(12).fill(10))).total).toBe(300);
  });

  it('tính toàn spare 5/ là 150', () => {
    expect(scoreFrames(framesFromRolls(Array(21).fill(5))).total).toBe(150);
  });

  it('tính toàn trượt là 0', () => {
    expect(scoreFrames(framesFromRolls(Array(20).fill(0))).total).toBe(0);
  });

  it('tính chuỗi strike, spare và open frame', () => {
    const rolls = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
    expect(scoreFrames(framesFromRolls(rolls)).total).toBe(167);
  });

  it('xử lý đúng ba cú thưởng ở frame 10', () => {
    const rolls = [...Array(9).fill(10), 10, 7, 3];
    expect(scoreFrames(framesFromRolls(rolls)).total).toBe(287);
  });
});

describe('khóa state machine và command trùng', () => {
  it('không nhận cùng command hai lần hoặc ném khi bóng đang chạy', () => {
    const session = new GameSession(1);
    expect(session.beginThrow('throw-1')).toBe(true);
    expect(session.beginThrow('throw-1')).toBe(false);
    expect(session.beginThrow('throw-2')).toBe(false);
    session.markSettling();
    session.recordRoll(7);
    session.finishTransition();
    expect(session.beginThrow('throw-2')).toBe(true);
  });

  it('giữ đúng rack cho cú hai và reset sau spare', () => {
    const session = new GameSession(1);
    session.beginThrow('a');
    session.markSettling();
    expect(session.recordRoll(7).rack).toBe('keep');
    session.finishTransition();
    session.beginThrow('b');
    session.markSettling();
    expect(session.recordRoll(3)).toMatchObject({ rack: 'reset', turnComplete: true, label: 'SPARE!' });
  });

  it('đặt đủ 10 chai cho cú thưởng sau strike ở frame 10', () => {
    const session = new GameSession(1);
    for (let frame = 0; frame < 9; frame += 1) {
      session.beginThrow(`strike-${frame}`);
      session.markSettling();
      session.recordRoll(10);
      session.finishTransition();
    }
    session.beginThrow('tenth-1');
    session.markSettling();
    expect(session.recordRoll(10).rack).toBe('reset');
    expect(session.standingPins).toBe(10);
    session.finishTransition();
    session.beginThrow('tenth-2');
    session.markSettling();
    expect(session.recordRoll(7).rack).toBe('keep');
    expect(session.standingPins).toBe(3);
  });
});
