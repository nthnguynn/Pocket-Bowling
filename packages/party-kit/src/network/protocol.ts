import { sanitizePlayerName } from '../players';
import type { PartyState, Seat } from '../types';

/** Lệnh từ điện thoại mà mọi game đều hiểu: vào phòng, điều khiển sảnh, đo độ trễ. */
export type LobbyAction = 'start' | 'restart' | 'next';
export type PartyCommand =
  | { type: 'hello'; clientId: string; name: string }
  | { type: 'lobby'; action: LobbyAction; seq: string }
  | { type: 'ping'; id: string; sentAt: number };

/**
 * Lệnh riêng của từng game (ném bóng, nhảy, húc…). Có `seq` thì host gửi lại ack.
 * Thư viện chung không biết nội dung: mỗi game tự khai báo kiểu và tự kiểm tra bằng `CommandParser`.
 */
export interface GameCommand { type: string; seq?: string }

/** Kiểm tra lệnh riêng của game; trả về null nếu không hợp lệ (bị chặn, không tới game). */
export type CommandParser<C extends GameCommand> = (data: Record<string, unknown>) => C | null;

/**
 * Tin từ màn hình chính xuống điện thoại. `view` là bản tóm tắt trạng thái game (mỗi game một kiểu),
 * `event` là sự kiện tức thời cho điện thoại (ví dụ rung khi bị húc).
 */
export type HostMessage<View = unknown, Event = unknown> =
  | { type: 'ack'; seq: string; accepted: boolean; reason?: string }
  | { type: 'view'; view: View | null; party: PartyState; seat: Seat }
  | { type: 'event'; event: Event }
  | { type: 'pong'; id: string; sentAt: number }
  | { type: 'notice'; message: string };

export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const validSeq = (value: unknown): value is string => typeof value === 'string' && value.length <= 80;
export const isClientId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value);
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const LOBBY_ACTIONS: readonly LobbyAction[] = ['start', 'restart', 'next'];
const PARTY_TYPES = new Set(['hello', 'lobby', 'ping']);

/** Không có lệnh riêng nào (ví dụ trang kho game). */
export const noGameCommands: CommandParser<never> = () => null;

/** Parse + validate một tin nhắn từ điện thoại: lệnh chung trước, còn lại giao cho parser của game. */
export function parseControllerCommand<C extends GameCommand>(raw: string, parseGame: CommandParser<C>): PartyCommand | C | null {
  if (raw.length > 2_048) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.type === 'hello' && isClientId(data.clientId)) {
    return { type: 'hello', clientId: data.clientId, name: sanitizePlayerName(data.name) };
  }
  if (data.type === 'lobby' && LOBBY_ACTIONS.includes(data.action as LobbyAction) && validSeq(data.seq)) {
    return { type: 'lobby', action: data.action as LobbyAction, seq: data.seq };
  }
  if (data.type === 'ping' && typeof data.id === 'string' && finite(data.sentAt)) {
    return { type: 'ping', id: data.id.slice(0, 80), sentAt: data.sentAt };
  }
  // Tên lệnh chung mà sai định dạng thì chặn luôn, không để game hiểu nhầm.
  if (typeof data.type !== 'string' || PARTY_TYPES.has(data.type)) return null;
  const command = parseGame(data);
  if (command && command.seq !== undefined && !validSeq(command.seq)) return null;
  return command;
}

export function isPartyCommand(command: PartyCommand | GameCommand): command is PartyCommand {
  return PARTY_TYPES.has(command.type);
}

export function serialize(message: PartyCommand | GameCommand | HostMessage): string {
  return JSON.stringify(message);
}
