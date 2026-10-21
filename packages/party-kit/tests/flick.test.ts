import { describe, expect, it } from 'vitest';
import { FlickDetector } from '../src/controller/FlickDetector';

type Vector = { x: number; y: number; z: number };
const v = (x: number, y: number, z: number): Vector => ({ x, y, z });
const add = (a: Vector, b: Vector) => v(a.x + b.x, a.y + b.y, a.z + b.z);

/** Phát chuỗi mẫu 60 Hz: `linear(t)` là gia tốc đã bỏ trọng lực tại thời điểm t (ms). */
function run(gravity: Vector, linear: (t: number) => Vector, ms: number, withLinear = true): number[] {
  const detector = new FlickDetector();
  const flicks: number[] = [];
  detector.onFlick = () => flicks.push(time);
  let time = 0;
  for (; time <= ms; time += 16) {
    const a = linear(time);
    detector.push(add(gravity, a), withLinear ? a : null, time);
  }
  return flicks;
}

const rest = () => v(0, 0, 0);
/** Cú hất lên dọc trục `axis`, dài ~50 ms, bắt đầu ở `at`. */
const pulse = (axis: Vector, at: number, size = 14) => (t: number) => (t >= at && t < at + 50 ? v(axis.x * size, axis.y * size, axis.z * size) : rest());

describe('nhận diện hất điện thoại để nhảy', () => {
  it('máy nằm yên thì không nhảy', () => {
    expect(run(v(0, 0, 9.81), rest, 2_000)).toEqual([]);
  });

  it('cầm ngang như tấm bìa, hất lên thì nhảy đúng một lần', () => {
    expect(run(v(0, 0, 9.81), pulse(v(0, 0, 1), 500), 1_200)).toHaveLength(1);
  });

  it('cầm dựng đứng, hất lên cũng nhận', () => {
    expect(run(v(0, 9.81, 0), pulse(v(0, 1, 0), 500), 1_200)).toHaveLength(1);
  });

  it('không phụ thuộc quy ước dấu của trình duyệt (iOS cũ đảo dấu)', () => {
    expect(run(v(0, 0, -9.81), pulse(v(0, 0, -1), 500), 1_200)).toHaveLength(1);
  });

  it('giật xuống hoặc lắc ngang để lái thì không nhảy', () => {
    expect(run(v(0, 0, 9.81), pulse(v(0, 0, -1), 500, 16), 1_200)).toEqual([]);
    expect(run(v(0, 0, 9.81), pulse(v(1, 0, 0), 500, 16), 1_200)).toEqual([]);
    expect(run(v(0, 0, 9.81), pulse(v(0, 1, 0), 500, 16), 1_200)).toEqual([]);
  });

  it('một cú hất kéo dài không bị đếm hai lần; hai cú cách nhau đủ xa thì đếm hai', () => {
    const long = (t: number) => (t >= 300 && t < 700 ? v(0, 0, 13) : rest());
    expect(run(v(0, 0, 9.81), long, 1_200)).toHaveLength(1);
    const twice = (t: number) => (pulse(v(0, 0, 1), 300)(t).z || pulse(v(0, 0, 1), 1_000)(t).z ? v(0, 0, 14) : rest());
    expect(run(v(0, 0, 9.81), twice, 1_600)).toHaveLength(2);
  });

  it('trình duyệt không có gia tốc đã bỏ trọng lực: tự tách trọng lực vẫn nhận được', () => {
    expect(run(v(0, 0, 9.81), pulse(v(0, 0, 1), 800), 1_400, false)).toHaveLength(1);
    expect(run(v(0, 0, 9.81), rest, 1_400, false)).toEqual([]);
  });
});
