import type { PlayerSetup } from '@pocket/party-kit';

export type GamePhase =
  | 'AIMING'
  | 'READY'
  | 'ROLLING'
  | 'SETTLING'
  | 'SCORING'
  | 'TURN_TRANSITION'
  | 'GAME_OVER';

export interface ThrowInput {
  power: number;
  aim: number;
  spin: number;
  position: number;
  source: 'desktop' | 'phone-touch' | 'phone-motion';
}

export interface FrameData {
  rolls: number[];
}


export interface PlayerData {
  name: string;
  color: string;
  frames: FrameData[];
  frameIndex: number;
  total: number | null;
}

export interface GameSnapshot {
  phase: GamePhase;
  players: PlayerData[];
  activePlayer: number;
  standingPins: number;
  message: string;
  canThrow: boolean;
  lastResult?: { pins: number; label: string };
}
