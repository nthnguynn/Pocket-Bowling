import { MAX_PLAYERS } from '@pocket/party-kit';
import { describe, expect, it } from 'vitest';
import { GAMES, playerCountLabel } from '../src/catalog';

describe('kho game', () => {
  it('mỗi game tự đặt số người chơi, không vượt trần chung', () => {
    for (const game of GAMES) {
      expect(game.players.max).toBeGreaterThanOrEqual(1);
      expect(game.players.max).toBeLessThanOrEqual(MAX_PLAYERS);
      expect(game.players.local.length).toBeGreaterThan(0);
      expect([...game.players.local].sort((a, b) => a - b)).toEqual(game.players.local);
      game.players.local.forEach((count) => {
        expect(count).toBeGreaterThanOrEqual(1);
        expect(count).toBeLessThanOrEqual(game.players.max);
      });
    }
  });

  it('game đánh cùng lúc cho đông hơn bowling theo lượt', () => {
    const players = Object.fromEntries(GAMES.map((game) => [game.id, game.players]));
    expect(players.bowling).toEqual({ max: 6, local: [1, 2] });
    expect(players.sumo!.max).toBe(8);
    expect(players.marble!.max).toBe(8);
    expect(players.roll!.max).toBe(8);
    expect(playerCountLabel(players.sumo!)).toBe('1–8 người');
  });

  it('mỗi site một id và một cổng dev riêng, không trùng cổng kho game', () => {
    expect(new Set(GAMES.map((game) => game.id)).size).toBe(GAMES.length);
    const ports = GAMES.map((game) => game.devPort);
    expect(new Set(ports).size).toBe(ports.length);
    expect(ports).not.toContain(5173);
  });
});
