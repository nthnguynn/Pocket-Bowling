import { parseControllerCommand } from '@pocket/party-kit';
import { describe, expect, it } from 'vitest';
import { parseBowlingCommand } from '../src/protocol';

const parse = (data: unknown) => parseControllerCommand(JSON.stringify(data), parseBowlingCommand);

describe('lệnh ném từ điện thoại', () => {
  it('clamp các giá trị ném vào miền an toàn', () => {
    expect(parse({ type: 'throw', seq: 'one', power: 8, aim: -4, spin: 3, position: 2, source: 'phone-touch' }))
      .toMatchObject({ power: 1, aim: -1, spin: 1, position: 1 });
  });

  it('chặn source và kiểu dữ liệu không hợp lệ', () => {
    expect(parse({ type: 'throw', seq: 'one', power: 'max', aim: 0, spin: 0, position: 0, source: 'hacker' })).toBeNull();
    expect(parse({ type: 'throw', seq: 'one', power: 0.5, aim: 0, spin: 0, position: 0, source: 'desktop' })).toBeNull();
  });

  it('nhận ngắm, chuẩn bị và hủy', () => {
    expect(parse({ type: 'aim', aim: 2, spin: 0, position: 0 })).toEqual({ type: 'aim', aim: 1, spin: 0, position: 0 });
    expect(parse({ type: 'prepare', seq: 'p' })).toEqual({ type: 'prepare', seq: 'p' });
    expect(parse({ type: 'cancel' })).toBeNull();
  });
});
