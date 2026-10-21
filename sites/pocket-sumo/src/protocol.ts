import { clamp, finite, validSeq, type CommandParser } from '@pocket/party-kit';

/** Lệnh riêng của Sumo: húc (hoặc thổi khi đã là hồn ma) theo hướng x/y; 0,0 là theo hướng mặt. */
export type SumoCommand = { type: 'dash'; seq: string; x: number; y: number };

export const parseSumoCommand: CommandParser<SumoCommand> = (data) => {
  if (data.type === 'dash' && validSeq(data.seq) && finite(data.x) && finite(data.y)) {
    return { type: 'dash', seq: data.seq, x: clamp(data.x, -1, 1), y: clamp(data.y, -1, 1) };
  }
  return null;
};

/** Rung điện thoại ngay khi sự kiện xảy ra, không chờ bản tóm tắt định kỳ. */
export type BuzzKind = 'hit' | 'land' | 'fall' | 'ko' | 'round-win' | 'match-win' | 'warn';
export interface SumoBuzz { kind: BuzzKind; strength: number }
