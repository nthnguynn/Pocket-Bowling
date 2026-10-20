import { PLAYER_COLORS } from '@pocket/party-kit';
import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/GameSession';

describe('ván bowling nhiều người', () => {
  it('xoay vòng lượt qua 3 người và giữ màu từng người', () => {
    const session = new GameSession([
      { name: 'A', color: PLAYER_COLORS[0] },
      { name: 'B', color: PLAYER_COLORS[1] },
      { name: 'C', color: PLAYER_COLORS[2] },
    ]);
    const order: number[] = [];
    for (let turn = 0; turn < 4; turn += 1) {
      order.push(session.activePlayer);
      session.beginThrow(`t-${turn}`);
      session.markSettling();
      session.recordRoll(10);
      session.finishTransition();
    }
    expect(order).toEqual([0, 1, 2, 0]);
    expect(session.snapshot().players.map((player) => player.color)).toEqual(PLAYER_COLORS.slice(0, 3));
  });

  it('báo hòa khi nhiều người cùng điểm cao nhất', () => {
    const session = new GameSession(2);
    for (let roll = 0; roll < 40; roll += 1) {
      session.beginThrow(`r-${roll}`);
      session.markSettling();
      session.recordRoll(0);
      session.finishTransition();
    }
    expect(session.phase).toBe('GAME_OVER');
    expect(session.message).toContain('Hòa 0 điểm');
  });
});

