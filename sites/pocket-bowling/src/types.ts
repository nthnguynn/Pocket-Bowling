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

export interface PlayerSetup {
  name: string;
  color: string;
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

export interface NetworkStats {
  signaling: string;
  ice: string;
  control: string;
  telemetry: string;
  route: 'direct' | 'relay' | 'unknown';
  localCandidate: string;
  remoteCandidate: string;
  rttMs: number | null;
  inputToVisualMs: number | null;
  bytesSent: number;
  bytesReceived: number;
  error: string;
  forceRelay: boolean;
  controllers: number;
}

/** lobby: TV đang ở sảnh chờ · local: chơi trên máy host, điện thoại là tay cầm chung · party: mỗi điện thoại là một người chơi. */
export type PartyStage = 'lobby' | 'local' | 'party';

export interface PartyMember {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  player: number | null;
}

export interface PartyState {
  stage: PartyStage;
  members: PartyMember[];
  maxPlayers: number;
  leader: string | null;
}

export interface Seat {
  member: string | null;
  player: number | null;
  leader: boolean;
  control: boolean;
}
