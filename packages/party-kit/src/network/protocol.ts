import { sanitizePlayerName } from '../game/players';
import type { RaceView } from '../marble/MarbleRace';
import type { GameSnapshot, PartyState, Seat, ThrowInput } from '../types';

export interface ThrowCommand extends ThrowInput {
  type: 'throw';
  seq: string;
}

export type ControllerCommand =
  | ThrowCommand
  | { type: 'aim'; aim: number; spin: number; position: number }
  | { type: 'prepare'; seq: string }
  | { type: 'cancel'; seq: string }
  | { type: 'hello'; clientId: string; name: string }
  | { type: 'lobby'; action: 'start' | 'restart'; seq: string }
  | { type: 'jump'; seq: string }
  | { type: 'ping'; id: string; sentAt: number };

export type HostCommand =
  | { type: 'ack'; seq: string; accepted: boolean; reason?: string }
  | { type: 'state'; snapshot: GameSnapshot; party: PartyState; seat: Seat }
  | { type: 'race'; view: RaceView | null; party: PartyState; seat: Seat }
  | { type: 'pong'; id: string; sentAt: number }
  | { type: 'notice'; message: string };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validSeq = (value: unknown): value is string => typeof value === 'string' && value.length <= 80;
export const isClientId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function parseControllerCommand(raw: string): ControllerCommand | null {
  if (raw.length > 2_048) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.type === 'throw') {
    if (typeof data.seq !== 'string' || data.seq.length > 80 || !finite(data.power)
      || !finite(data.aim) || !finite(data.spin) || !finite(data.position)) return null;
    if (!['phone-touch', 'phone-motion'].includes(String(data.source))) return null;
    return {
      type: 'throw',
      seq: data.seq,
      power: clamp(data.power, 0.2, 1),
      aim: clamp(data.aim, -1, 1),
      spin: clamp(data.spin, -1, 1),
      position: clamp(data.position, -1, 1),
      source: data.source as 'phone-touch' | 'phone-motion',
    };
  }
  if (data.type === 'aim' && finite(data.aim) && finite(data.spin) && finite(data.position)) {
    return { type: 'aim', aim: clamp(data.aim, -1, 1), spin: clamp(data.spin, -1, 1), position: clamp(data.position, -1, 1) };
  }
  if ((data.type === 'prepare' || data.type === 'cancel') && validSeq(data.seq)) {
    return { type: data.type, seq: data.seq };
  }
  if (data.type === 'hello' && isClientId(data.clientId)) {
    return { type: 'hello', clientId: data.clientId, name: sanitizePlayerName(data.name) };
  }
  if (data.type === 'jump' && validSeq(data.seq)) {
    return { type: 'jump', seq: data.seq };
  }
  if (data.type === 'lobby' && (data.action === 'start' || data.action === 'restart') && validSeq(data.seq)) {
    return { type: 'lobby', action: data.action, seq: data.seq };
  }
  if (data.type === 'ping' && typeof data.id === 'string' && finite(data.sentAt)) {
    return { type: 'ping', id: data.id.slice(0, 80), sentAt: data.sentAt };
  }
  return null;
}

export function serialize(message: ControllerCommand | HostCommand): string {
  return JSON.stringify(message);
}
