import { describe, expect, it } from 'vitest';
import { parseControllerCommand } from '../src/network/protocol';

describe('xác thực input mạng', () => {
  it('clamp các giá trị ném vào miền an toàn', () => {
    const command = parseControllerCommand(JSON.stringify({
      type: 'throw', seq: 'one', power: 8, aim: -4, spin: 3, position: 2, source: 'phone-touch',
    }));
    expect(command).toMatchObject({ power: 1, aim: -1, spin: 1, position: 1 });
  });

  it('chặn source và kiểu dữ liệu không hợp lệ', () => {
    expect(parseControllerCommand(JSON.stringify({
      type: 'throw', seq: 'one', power: 'max', aim: 0, spin: 0, position: 0, source: 'hacker',
    }))).toBeNull();
  });

  it('chặn payload quá lớn trước khi parse', () => {
    expect(parseControllerCommand(`{"type":"aim","padding":"${'x'.repeat(3_000)}"}`)).toBeNull();
  });

  it('nhận hello hợp lệ và làm sạch tên', () => {
    expect(parseControllerCommand(JSON.stringify({ type: 'hello', clientId: 'abcdef0123456789', name: ' <i>Minh</i> ' })))
      .toEqual({ type: 'hello', clientId: 'abcdef0123456789', name: 'iMinh/i' });
  });

  it('chặn hello thiếu định danh và lệnh sảnh lạ', () => {
    expect(parseControllerCommand(JSON.stringify({ type: 'hello', clientId: 'x', name: 'A' }))).toBeNull();
    expect(parseControllerCommand(JSON.stringify({ type: 'lobby', action: 'kick', seq: '1' }))).toBeNull();
    expect(parseControllerCommand(JSON.stringify({ type: 'lobby', action: 'start', seq: '1' }))).toEqual({ type: 'lobby', action: 'start', seq: '1' });
  });
});
