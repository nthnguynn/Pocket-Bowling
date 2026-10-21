import { defaultPlayers, MAX_PLAYERS, type PlayerSetup } from '@pocket/party-kit';
import type { GamePhase, GameSnapshot, PlayerData } from '../types';
import { createEmptyFrames, scoreFrames } from './scoring';

export interface RollResolution {
  rack: 'keep' | 'reset';
  turnComplete: boolean;
  gameOver: boolean;
  label: string;
}

/** Số người (tên/màu mặc định) hoặc danh sách người chơi cụ thể, ví dụ từ sảnh party. */
export type PlayerLineup = number | PlayerSetup[];

function buildPlayers(lineup: PlayerLineup): PlayerData[] {
  const setups = typeof lineup === 'number' ? defaultPlayers(lineup) : lineup.slice(0, MAX_PLAYERS);
  if (!setups.length) throw new Error('Cần ít nhất một người chơi');
  return setups.map(({ name, color }) => ({ name, color, frames: createEmptyFrames(), frameIndex: 0, total: null }));
}

export class GameSession {
  players: PlayerData[];
  activePlayer = 0;
  phase: GamePhase = 'AIMING';
  standingPins = 10;
  message = 'Chỉnh hướng, lực và độ xoáy';
  lastResult?: { pins: number; label: string };
  private readonly commandIds = new Set<string>();

  constructor(lineup: PlayerLineup = 1) {
    this.players = buildPlayers(lineup);
  }

  reset(lineup: PlayerLineup = this.players.map(({ name, color }) => ({ name, color }))): void {
    this.players = buildPlayers(lineup);
    this.activePlayer = 0;
    this.phase = 'AIMING';
    this.standingPins = 10;
    this.lastResult = undefined;
    this.message = this.players.length === 1 ? 'Chỉnh hướng, lực và độ xoáy' : `${this.players[0]!.name} — đến lượt bạn`;
    this.commandIds.clear();
  }

  prepare(): boolean {
    if (this.phase !== 'AIMING') return false;
    this.phase = 'READY';
    this.message = 'Sẵn sàng — thả để ném';
    return true;
  }

  cancelPrepare(): void {
    if (this.phase !== 'READY') return;
    this.phase = 'AIMING';
    this.message = 'Đã hủy cú ném';
  }

  beginThrow(commandId: string): boolean {
    if (this.commandIds.has(commandId)) return false;
    if (this.phase !== 'AIMING' && this.phase !== 'READY') return false;
    this.commandIds.add(commandId);
    if (this.commandIds.size > 200) {
      const oldest = this.commandIds.values().next().value as string | undefined;
      if (oldest) this.commandIds.delete(oldest);
    }
    this.phase = 'ROLLING';
    this.message = 'Bóng đang lăn…';
    return true;
  }

  markSettling(): void {
    if (this.phase !== 'ROLLING') return;
    this.phase = 'SETTLING';
    this.message = 'Đang chờ chai ổn định…';
  }

  recordRoll(pins: number): RollResolution {
    if (this.phase !== 'SETTLING' && this.phase !== 'ROLLING') {
      throw new Error(`Không thể ghi điểm trong trạng thái ${this.phase}`);
    }
    this.phase = 'SCORING';
    const hit = Math.max(0, Math.min(this.standingPins, Math.round(pins)));
    const player = this.players[this.activePlayer];
    if (!player) throw new Error('Không tìm thấy người chơi hiện tại');
    const frameIndex = player.frameIndex;
    const frame = player.frames[frameIndex];
    if (!frame) throw new Error('Ván đã kết thúc');
    const rollIndex = frame.rolls.length;
    frame.rolls.push(hit);
    this.standingPins -= hit;

    let rack: 'keep' | 'reset' = 'keep';
    let turnComplete = false;

    if (frameIndex < 9) {
      if (rollIndex === 0 && hit === 10) {
        rack = 'reset';
        turnComplete = true;
      } else if (rollIndex === 1) {
        rack = 'reset';
        turnComplete = true;
      }
    } else if (rollIndex === 0) {
      if (hit === 10) rack = 'reset';
    } else if (rollIndex === 1) {
      const first = frame.rolls[0] ?? 0;
      if (first === 10) {
        if (hit === 10) rack = 'reset';
      } else if (first + hit === 10) {
        rack = 'reset';
      } else {
        turnComplete = true;
      }
    } else {
      turnComplete = true;
      rack = 'reset';
    }

    const label = this.resultLabel(frame.rolls, rollIndex, hit);
    this.lastResult = { pins: hit, label };
    this.message = label;
    this.players.forEach((entry) => {
      entry.total = scoreFrames(entry.frames).total;
    });

    if (turnComplete) player.frameIndex += 1;
    const gameOver = this.players.every((entry) => entry.frameIndex >= 10);

    // Bonus balls in frame 10 may require a fresh full rack without ending the turn.
    if (rack === 'reset' && !turnComplete) this.standingPins = 10;

    if (gameOver) {
      this.phase = 'GAME_OVER';
      const best = Math.max(...this.players.map((entry) => entry.total ?? 0));
      const winners = this.players.filter((entry) => (entry.total ?? 0) === best);
      this.message = this.players.length === 1
        ? `Hoàn tất — ${best} điểm!`
        : winners.length > 1
          ? `Hòa ${best} điểm: ${winners.map((entry) => entry.name).join(', ')}`
          : `${winners[0]!.name} thắng với ${best} điểm!`;
    } else if (turnComplete) {
      this.phase = 'TURN_TRANSITION';
      this.advancePlayer();
      this.standingPins = 10;
    } else {
      this.phase = 'TURN_TRANSITION';
    }

    return { rack, turnComplete, gameOver, label };
  }

  finishTransition(): void {
    if (this.phase !== 'TURN_TRANSITION') return;
    this.phase = 'AIMING';
    // Chơi một mình thì không cần báo "đến lượt ai".
    this.message = this.players.length === 1
      ? 'Chỉnh hướng, lực và độ xoáy'
      : `${this.players[this.activePlayer]?.name ?? 'Người chơi'} — đến lượt bạn`;
  }

  snapshot(): GameSnapshot {
    return {
      phase: this.phase,
      players: this.players.map((player) => ({
        ...player,
        frames: player.frames.map((frame) => ({ rolls: [...frame.rolls] })),
      })),
      activePlayer: this.activePlayer,
      standingPins: this.standingPins,
      message: this.message,
      canThrow: this.phase === 'AIMING' || this.phase === 'READY',
      lastResult: this.lastResult,
    };
  }

  private advancePlayer(): void {
    for (let offset = 1; offset <= this.players.length; offset += 1) {
      const candidate = (this.activePlayer + offset) % this.players.length;
      if ((this.players[candidate]?.frameIndex ?? 10) < 10) {
        this.activePlayer = candidate;
        return;
      }
    }
  }

  private resultLabel(rolls: number[], rollIndex: number, hit: number): string {
    if (hit === 10) return 'STRIKE!';
    if (rollIndex > 0 && (rolls[rollIndex - 1] ?? 0) + hit === 10) return 'SPARE!';
    if (hit === 0) return 'Trượt rồi — thử lại nào';
    return `${hit} chai!`;
  }
}
