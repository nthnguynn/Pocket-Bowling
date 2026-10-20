import { describe, expect, it } from 'vitest';
import { generateCourse, LANE_WIDTH, MARBLE_RADIUS, type Course, type Obstacle } from '../src/marble/course';
import { COUNTDOWN_SECONDS, FINISH_GRACE_SECONDS, GEM_BONUS_SECONDS, MarbleRace } from '../src/marble/MarbleRace';
import { createMarble, CRUISE_SPEED, stepMarble, stepTray, type MarbleEvent } from '../src/marble/physics';

const DT = 1 / 120;

function course(obstacles: Obstacle[], length = 600): Course {
  return { seed: 0, length, obstacles: [...obstacles].sort((a, b) => a.y - b.y), gemCount: obstacles.filter((o) => o.kind === 'gem').length };
}

function run(marble = createMarble(), track: Course, seconds: number, input = { tilt: 0, jump: false }, onStep?: (t: number) => { tilt: number; jump: boolean } | void) {
  marble.status = marble.status === 'ready' ? 'rolling' : marble.status;
  const events: MarbleEvent[] = [];
  for (let t = 0; t < seconds; t += DT) stepMarble(marble, onStep?.(t) ?? input, track, t, DT, events);
  return { marble, events };
}

/** Các khoảng x không bị phủ bởi `intervals` trong [0, LANE_WIDTH]. */
function freeGaps(intervals: Array<[number, number]>): number[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const gaps: number[] = [];
  let cursor = 0;
  for (const [from, to] of sorted) {
    if (from > cursor) gaps.push(from - cursor);
    cursor = Math.max(cursor, to);
  }
  if (cursor < LANE_WIDTH) gaps.push(LANE_WIDTH - cursor);
  return gaps;
}

describe('sinh đường đua', () => {
  it('cùng seed cho cùng đường, khác seed cho đường khác', () => {
    expect(generateCourse(42)).toEqual(generateCourse(42));
    expect(generateCourse(42).obstacles).not.toEqual(generateCourse(43).obstacles);
  });

  it('mọi lát cắt ngang đều lăn qua được hoặc nhảy qua được', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const track = generateCourse(seed);
      for (let y = 0; y < track.length; y += 1) {
        const at = track.obstacles.filter((o) => o.kind !== 'gem' && y >= o.y && y <= o.y + (o as { h: number }).h);
        const blocks = at.filter((o) => o.kind === 'block') as Array<{ x: number; w: number }>;
        const holes = at.filter((o) => o.kind === 'hole') as Array<{ x: number; w: number; h: number }>;
        if (blocks.length) expect(Math.max(...freeGaps(blocks.map((b) => [b.x, b.x + b.w])))).toBeGreaterThan(MARBLE_RADIUS * 2 + 4);
        if (holes.length) {
          const widest = Math.max(0, ...freeGaps(holes.map((h) => [h.x, h.x + h.w])));
          // Hoặc có khe lăn qua, hoặc hố đủ ngắn để nhảy (bay ~0,63 s × 95 đơn vị/s).
          if (widest <= MARBLE_RADIUS * 2 + 4) expect(Math.max(...holes.map((h) => h.h))).toBeLessThan(45);
        }
        expect(blocks.length && holes.length).toBeFalsy();
      }
    }
  });
});

describe('vật lý viên bi', () => {
  it('tự lăn tới tốc độ hành trình và về đích', () => {
    const { marble, events } = run(undefined, course([], 300), 6);
    expect(marble.status).toBe('finished');
    expect(marble.finishTime).toBeGreaterThan(300 / CRUISE_SPEED);
    expect(events).toContain('finish');
  });

  it('nghiêng điện thoại thì bi dạt sang bên nhưng không ra khỏi làn', () => {
    const { marble } = run(undefined, course([], 5_000), 3, { tilt: 1, jump: false });
    expect(marble.x).toBeCloseTo(LANE_WIDTH - MARBLE_RADIUS, 5);
  });

  it('lăn vào hố thì rơi và được đặt lại trước hố, ở khe an toàn', () => {
    const hole: Obstacle = { kind: 'hole', x: 0, y: 100, w: LANE_WIDTH, h: 26, safeX: 30 };
    const { marble, events } = run(undefined, course([hole]), 3);
    expect(events).toContain('fall');
    expect(events).toContain('respawn');
    expect(events.indexOf('fall')).toBeLessThan(events.indexOf('respawn'));
    expect(marble.status).toBe('rolling');
    expect(marble.x).toBeCloseTo(30);
  });

  it('nhảy đúng lúc thì bay qua hố chắn ngang', () => {
    const hole: Obstacle = { kind: 'hole', x: 0, y: 140, w: LANE_WIDTH, h: 26, safeX: 50 };
    const marble = createMarble();
    const { events } = run(marble, course([hole], 400), 5, undefined, () => ({ tilt: 0, jump: marble.y > 118 && marble.y < 130 }));
    expect(events).toContain('jump');
    expect(events).not.toContain('fall');
    expect(marble.status).toBe('finished');
  });

  it('va trực diện vào khối thì bật lại, bị choáng và không xuyên qua', () => {
    const block: Obstacle = { kind: 'block', x: 0, y: 120, w: LANE_WIDTH, h: 14 };
    const { marble, events } = run(undefined, course([block]), 4);
    expect(events).toContain('bump');
    expect(marble.y).toBeLessThan(120);
  });

  it('nhặt ngọc một lần duy nhất', () => {
    const gems: Obstacle[] = [{ kind: 'gem', id: 0, x: 50, y: 80 }, { kind: 'gem', id: 1, x: 5, y: 160 }];
    const { marble, events } = run(undefined, course(gems, 300), 4);
    expect(events.filter((e) => e === 'gem')).toHaveLength(1);
    expect([...marble.collected]).toEqual([0]);
  });
});

describe('khay giữ bi trên điện thoại', () => {
  it('nghiêng vừa phải thì bi không rơi', () => {
    const tray = { position: 0, velocity: 0 };
    let dropped = false;
    for (let t = 0; t < 10; t += DT) dropped ||= stepTray(tray, 0.45, DT);
    expect(dropped).toBe(false);
  });

  it('giữ nghiêng hết cỡ khoảng 2 giây thì bi rơi khỏi khay', () => {
    const tray = { position: 0, velocity: 0 };
    let droppedAt = -1;
    for (let t = 0; t < 5 && droppedAt < 0; t += DT) if (stepTray(tray, 1, DT)) droppedAt = t;
    expect(droppedAt).toBeGreaterThan(1.2);
    expect(droppedAt).toBeLessThan(3);
  });
});

describe('cuộc đua', () => {
  it('đếm ngược rồi mới cho lăn', () => {
    const race = new MarbleRace([{ name: 'A', color: '#ff5caf' }], 7);
    race.advance(1);
    expect(race.phase).toBe('countdown');
    expect(race.racers[0]!.marble.y).toBe(0);
    for (let t = 0; t < COUNTDOWN_SECONDS; t += 0.05) race.advance(0.05);
    expect(race.phase).toBe('racing');
  });

  it('kết thúc sau thời gian ân hạn khi đã có người về đích', () => {
    const race = new MarbleRace([{ name: 'A', color: '#ff5caf' }, { name: 'B', color: '#4cc9ff' }], 7);
    race.time = 10;
    race.phase = 'racing';
    race.racers.forEach((racer) => { racer.marble.status = 'rolling'; });
    race.racers[0]!.marble.y = race.course.length + 1;
    race.racers[1]!.marble.status = 'falling';
    race.racers[1]!.marble.fallTimer = 1_000;
    race.step(1 / 120);
    expect(race.view().graceLeft).toBeCloseTo(FINISH_GRACE_SECONDS, 1);
    for (let t = 0; t < FINISH_GRACE_SECONDS + 1; t += 1 / 120) race.step(1 / 120);
    expect(race.phase).toBe('finished');
    expect(race.ranking()).toEqual([0, 1]);
  });

  it('ngọc trừ thời gian và có thể đảo thứ hạng', () => {
    const race = new MarbleRace([{ name: 'A', color: '#ff5caf' }, { name: 'B', color: '#4cc9ff' }], 7);
    const [a, b] = race.racers;
    a!.marble.finishTime = 40;
    b!.marble.finishTime = 41;
    [0, 1, 2, 3].forEach((id) => b!.marble.collected.add(id));
    expect(race.score(b!)).toBeCloseTo(41 - 4 * GEM_BONUS_SECONDS);
    expect(race.ranking()).toEqual([1, 0]);
  });
});

describe('bot', () => {
  it('bot về đích trên nhiều đường ngẫu nhiên (đường luôn đi được)', () => {
    const times: number[] = [];
    for (let seed = 1; seed <= 12; seed += 1) {
      const race = new MarbleRace([{ name: 'Bot', color: '#ff5caf', botSkill: 1 }], seed);
      while (race.phase !== 'finished') race.step(1 / 120);
      const finish = race.racers[0]!.marble.finishTime;
      expect(finish, `seed ${seed}`).not.toBeNull();
      times.push(finish!);
    }
    // Đua một mình nên hết khi bot về đích; trung bình nên quanh 35–70 giây.
    const average = times.reduce((a, b) => a + b, 0) / times.length;
    expect(average).toBeGreaterThan(30);
    expect(average).toBeLessThan(80);
  });
});
