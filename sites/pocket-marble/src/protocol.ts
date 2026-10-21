import { validSeq, type CommandParser } from '@pocket/party-kit';

/** Lệnh riêng của Marble: nhảy (hất điện thoại lên, hoặc chạm khay/nút NHẢY). Độ nghiêng đi qua kênh telemetry, không phải lệnh. */
export type MarbleCommand = { type: 'jump'; seq: string };

export const parseMarbleCommand: CommandParser<MarbleCommand> = (data) =>
  data.type === 'jump' && validSeq(data.seq) ? { type: 'jump', seq: data.seq } : null;

/** Sự kiện tức thì TV gửi riêng cho điện thoại của người gây ra: rung theo kiểu riêng và chữ nổi trên khay. */
export type MarbleBuzzKind = 'gem' | 'bump' | 'boost' | 'fall' | 'drop' | 'finish' | 'out';
export interface MarbleBuzz { kind: MarbleBuzzKind }
export const MARBLE_BUZZ_KINDS: ReadonlySet<string> = new Set<MarbleBuzzKind>(['gem', 'bump', 'boost', 'fall', 'drop', 'finish', 'out']);
