import { validSeq, type CommandParser } from '@pocket/party-kit';

/** Lệnh riêng của Pocket Marble: chạm khay để nhảy. Độ nghiêng đi qua kênh telemetry, không phải lệnh. */
export type MarbleCommand = { type: 'jump'; seq: string };

export const parseMarbleCommand: CommandParser<MarbleCommand> = (data) =>
  data.type === 'jump' && validSeq(data.seq) ? { type: 'jump', seq: data.seq } : null;
