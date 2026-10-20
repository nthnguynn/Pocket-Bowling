import { describe, expect, it } from 'vitest';
import { noGameCommands, parseControllerCommand, validSeq, type CommandParser } from '../src/network/protocol';

type TestCommand = { type: 'poke'; seq: string; power: number };
const parsePoke: CommandParser<TestCommand> = (data) =>
  data.type === 'poke' && validSeq(data.seq) && typeof data.power === 'number' ? { type: 'poke', seq: data.seq, power: data.power } : null;

describe('xác thực input mạng (phần chung)', () => {
  it('chặn payload quá lớn trước khi parse', () => {
    expect(parseControllerCommand(`{"type":"poke","padding":"${'x'.repeat(3_000)}"}`, parsePoke)).toBeNull();
  });

  it('nhận hello hợp lệ và làm sạch tên', () => {
    expect(parseControllerCommand(JSON.stringify({ type: 'hello', clientId: 'abcdef0123456789', name: ' <i>Minh</i> ' }), noGameCommands))
      .toEqual({ type: 'hello', clientId: 'abcdef0123456789', name: 'iMinh/i' });
  });

  it('chặn hello thiếu định danh và lệnh sảnh lạ; nhận đủ start/restart/next', () => {
    expect(parseControllerCommand(JSON.stringify({ type: 'hello', clientId: 'x', name: 'A' }), noGameCommands)).toBeNull();
    expect(parseControllerCommand(JSON.stringify({ type: 'lobby', action: 'kick', seq: '1' }), noGameCommands)).toBeNull();
    for (const action of ['start', 'restart', 'next']) {
      expect(parseControllerCommand(JSON.stringify({ type: 'lobby', action, seq: '1' }), noGameCommands)).toEqual({ type: 'lobby', action, seq: '1' });
    }
  });

  it('lệnh lạ được giao cho parser của game; game không có parser thì bị chặn', () => {
    const raw = JSON.stringify({ type: 'poke', seq: 'p1', power: 3 });
    expect(parseControllerCommand(raw, parsePoke)).toEqual({ type: 'poke', seq: 'p1', power: 3 });
    expect(parseControllerCommand(raw, noGameCommands)).toBeNull();
  });

  it('tên lệnh chung sai định dạng không được chuyển sang game', () => {
    const sneaky: CommandParser<{ type: string }> = (data) => ({ type: String(data.type) });
    expect(parseControllerCommand(JSON.stringify({ type: 'hello', clientId: 'x' }), sneaky)).toBeNull();
    expect(parseControllerCommand(JSON.stringify({ type: 'poke', seq: 'x'.repeat(100) }), (data) => ({ type: 'poke', seq: String(data.seq) }))).toBeNull();
  });
});
