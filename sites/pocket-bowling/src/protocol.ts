import { clamp, finite, validSeq, type CommandParser } from '@pocket/party-kit';
import type { ThrowInput } from './types';

/** Lệnh riêng của Pocket Bowling từ điện thoại người đang tới lượt. */
export interface ThrowCommand extends ThrowInput {
  type: 'throw';
  seq: string;
}

export type BowlingCommand =
  | ThrowCommand
  | { type: 'aim'; aim: number; spin: number; position: number }
  | { type: 'prepare'; seq: string }
  | { type: 'cancel'; seq: string };

/** Kiểm tra và kẹp mọi giá trị ném vào miền an toàn; vật lý vẫn chỉ chạy trên màn hình chính. */
export const parseBowlingCommand: CommandParser<BowlingCommand> = (data) => {
  if (data.type === 'throw') {
    if (!validSeq(data.seq) || !finite(data.power) || !finite(data.aim) || !finite(data.spin) || !finite(data.position)) return null;
    if (data.source !== 'phone-touch' && data.source !== 'phone-motion') return null;
    return {
      type: 'throw',
      seq: data.seq,
      power: clamp(data.power, 0.2, 1),
      aim: clamp(data.aim, -1, 1),
      spin: clamp(data.spin, -1, 1),
      position: clamp(data.position, -1, 1),
      source: data.source,
    };
  }
  if (data.type === 'aim' && finite(data.aim) && finite(data.spin) && finite(data.position)) {
    return { type: 'aim', aim: clamp(data.aim, -1, 1), spin: clamp(data.spin, -1, 1), position: clamp(data.position, -1, 1) };
  }
  if ((data.type === 'prepare' || data.type === 'cancel') && validSeq(data.seq)) {
    return { type: data.type, seq: data.seq };
  }
  return null;
};
