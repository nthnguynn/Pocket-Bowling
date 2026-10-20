import { describe, expect, it } from 'vitest';
import { launchVelocity } from '../src/game/physicsMath';

describe('tham số ném vật lý', () => {
  it('lực mạnh tạo vận tốc lớn hơn', () => {
    const soft = launchVelocity({ aim: 0, power: 0.25 });
    const hard = launchVelocity({ aim: 0, power: 1 });
    expect(Math.abs(hard.z)).toBeGreaterThan(Math.abs(soft.z));
  });

  it('góc ném đổi thành phần vận tốc ngang nhưng vẫn đi về phía chai', () => {
    const left = launchVelocity({ aim: -1, power: 0.7 });
    const right = launchVelocity({ aim: 1, power: 0.7 });
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(left.z).toBeLessThan(0);
    expect(right.z).toBeLessThan(0);
  });
});
