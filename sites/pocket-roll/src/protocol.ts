import { validSeq, type CommandParser } from '@pocket/party-kit';

/** Lệnh riêng của Roll: nhảy (hất điện thoại lên, hoặc nút NHẢY khi không có cảm biến). Độ nghiêng đi qua kênh telemetry, không phải lệnh. */
export type RollCommand = { type: 'jump'; seq: string };

export const parseRollCommand: CommandParser<RollCommand> = (data) =>
  data.type === 'jump' && validSeq(data.seq) ? { type: 'jump', seq: data.seq } : null;

/** Rung điện thoại ngay khi sự kiện xảy ra: rách giấy, chạm cờ, giao giấy, tiếp đất mạnh. */
export type BuzzKind = 'die' | 'checkpoint' | 'goal' | 'land';
export interface RollBuzz { kind: BuzzKind; strength: number }
