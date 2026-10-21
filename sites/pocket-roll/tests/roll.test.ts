import { describe, expect, it } from 'vitest';
import { botInput, createBotMemory } from '../src/bot';
import { LEVELS } from '../src/levels';
import { parseRollCommand } from '../src/protocol';
import {
  createRoll, createWorld, queueJump, ROLL_RADIUS, stepRoll, stepWorld, WORLD_HEIGHT, WORLD_WIDTH,
  type Level, type RollEvent, type RollState,
} from '../src/physics';
import { COUNTDOWN_SECONDS, FINISH_GRACE_SECONDS, LEVEL_END_SECONDS, RollMatch, type MatchEvent } from '../src/RollMatch';

const DT = 1 / 120;

function level(overrides: Partial<Level>): Level {
  return {
    id: 0, name: 'Test', hint: '', spawn: [100, 300], goal: { x: 1500, y: 0, w: 100, h: 50 },
    platforms: [{ a: [0, 400], b: [1600, 400] }], route: [], ...overrides,
  };
}

/** Chạy một cuộn giấy trên màn `track`; `input` cho độ nghiêng và có nhảy ở mỗi bước không. */
function run(track: Level, seconds: number, input: (roll: RollState, t: number) => { tilt: number; jump?: boolean } = () => ({ tilt: 0 })) {
  const world = createWorld(track);
  const roll = createRoll(track);
  roll.status = 'rolling';
  const events: RollEvent[] = [];
  // Hỏi qua hàm để TypeScript không "chốt" status là 'rolling' sau phép gán ở trên.
  const finished = () => roll.status === 'done';
  for (let t = 0; t < seconds && !finished(); t += DT) {
    const { tilt, jump } = input(roll, t);
    if (jump) queueJump(roll);
    stepWorld(world, [roll], DT);
    stepRoll(roll, tilt, world, DT, events);
  }
  return { roll, events, world };
}

function players(count: number) {
  return Array.from({ length: count }, (_, index) => ({ key: `p${index}`, name: `P${index}`, color: '#ff5caf' }));
}

function toPlaying(match: RollMatch): void {
  for (let t = 0; t < COUNTDOWN_SECONDS + 0.05; t += DT) match.step(DT);
}

describe('các màn chơi', () => {
  it('có đủ 10 màn, id liên tục, mọi thứ nằm trong khung 1600 × 900', () => {
    expect(LEVELS).toHaveLength(10);
    LEVELS.forEach((entry, index) => {
      expect(entry.id).toBe(index + 1);
      expect(entry.route.length).toBeGreaterThan(0);
      const inside = (x: number, y: number) => x >= 0 && x <= WORLD_WIDTH && y >= 0 && y <= WORLD_HEIGHT;
      expect(inside(...entry.spawn)).toBe(true);
      expect(inside(entry.goal.x, entry.goal.y) && inside(entry.goal.x + entry.goal.w, entry.goal.y + entry.goal.h)).toBe(true);
      entry.platforms.forEach((platform) => expect(inside(...platform.a) && inside(...platform.b)).toBe(true));
      (entry.checkpoints ?? []).forEach((checkpoint) => expect(checkpoint.route).toBeLessThan(entry.route.length));
    });
  });

  // Bot đi theo route của từng màn: qua được nghĩa là màn chắc chắn có đường tới đích.
  it.each(LEVELS.map((entry) => [entry.id, entry.name, entry] as const))('bot qua được màn %i (%s)', (_id, _name, entry) => {
    const memory = createBotMemory();
    let clock = 0;
    const { roll } = run(entry, 60, (state) => {
      clock += DT;
      return botInput(state, entry, memory, clock);
    });
    expect(roll.status).toBe('done');
    expect(roll.deaths).toBeLessThanOrEqual(3);
  });
});

describe('vật lý cuộn giấy', () => {
  it('nghiêng thì lăn theo hướng nghiêng, thả ra thì chậm dần rồi dừng', () => {
    const flat = level({});
    const { roll } = run(flat, 1.5, () => ({ tilt: 1 }));
    expect(roll.x).toBeGreaterThan(400);
    expect(roll.vx).toBeGreaterThan(300);
    expect(roll.grounded).toBe(true);
    const back = run(flat, 4, (_, t) => ({ tilt: t < 1 ? -1 : 0 }));
    expect(Math.abs(back.roll.vx)).toBeLessThan(20);
  });

  it('chạm cưa thì rách giấy rồi sống lại ở chỗ xuất phát', () => {
    const track = level({ saws: [{ x: 400, y: 366, r: 30 }] });
    const { roll, events } = run(track, 3, (state) => ({ tilt: state.deaths ? 0 : 1 }));
    expect(events).toContainEqual({ type: 'die', cause: 'saw' });
    expect(events.some((event) => event.type === 'respawn')).toBe(true);
    expect(roll.deaths).toBeGreaterThanOrEqual(1);
  });

  it('nhảy đúng lúc thì qua được lưỡi cưa', () => {
    const track = level({ saws: [{ x: 500, y: 366, r: 30 }] });
    const { roll, events } = run(track, 2.5, (state) => ({ tilt: 1, jump: state.x > 380 && state.x < 400 }));
    expect(events.some((event) => event.type === 'jump')).toBe(true);
    expect(roll.deaths).toBe(0);
    expect(roll.x).toBeGreaterThan(600);
  });

  it('chạm cờ thì chết sẽ sống lại ở cờ', () => {
    const track = level({ checkpoints: [{ x: 300, y: 366, route: 0 }], saws: [{ x: 600, y: 366, r: 30 }] });
    const { roll, events } = run(track, 3, (_, t) => ({ tilt: t < 2 ? 1 : 0 }));
    expect(events.some((event) => event.type === 'checkpoint')).toBe(true);
    expect(roll.respawn[0]).toBe(300);
    expect(roll.status).toBe('rolling');
    expect(roll.x).toBeLessThan(600);
  });

  it('rơi xuống nước hoặc rơi khỏi màn là chết', () => {
    const wet = level({ platforms: [{ a: [0, 400], b: [300, 400] }], water: [{ x: 300, y: 700, w: 600, h: 200 }] });
    expect(run(wet, 2, () => ({ tilt: 1 })).events).toContainEqual({ type: 'die', cause: 'water' });
    const pit = level({ platforms: [{ a: [0, 400], b: [300, 400] }] });
    expect(run(pit, 3, () => ({ tilt: 1 })).events).toContainEqual({ type: 'die', cause: 'fall' });
  });

  it('vào vùng đích là giao xong và ghi thời gian', () => {
    const track = level({ goal: { x: 700, y: 300, w: 100, h: 100 } });
    const { roll, events } = run(track, 4, () => ({ tilt: 1 }));
    expect(roll.status).toBe('done');
    expect(roll.finishTime).toBeGreaterThan(0.5);
    expect(events.some((event) => event.type === 'goal')).toBe(true);
  });

  it('quạt đẩy cuộn giấy bay lên đều, không vọt khỏi màn', () => {
    const track = level({ fans: [{ x: 0, y: 100, w: 300, h: 300, lift: 340 }] });
    let highest = WORLD_HEIGHT;
    run(track, 4, (state) => {
      highest = Math.min(highest, state.y);
      return { tilt: 0 };
    });
    expect(highest).toBeLessThan(200);
    expect(highest).toBeGreaterThan(0);
  });

  it('đệm nảy bật cuộn giấy lên cao', () => {
    const track = level({ platforms: [{ a: [0, 400], b: [1600, 400], bouncy: true }] });
    const { events, roll } = run(track, 0.6);
    expect(events.some((event) => event.type === 'bounce')).toBe(true);
    expect(roll.y).toBeLessThan(300);
  });

  it('bập bênh nghiêng về phía cuộn giấy đứng', () => {
    const track = level({ platforms: [], seesaws: [{ x: 800, y: 400, length: 400 }], spawn: [920, 340] });
    const { world } = run(track, 2);
    expect(world.seesaws[0]!.angle).toBeGreaterThan(0.1);
  });

  it('đứng yên trên bục di chuyển thì được chở theo', () => {
    const track = level({ platforms: [], movers: [{ a: [0, 400], b: [400, 400], move: [600, 0], period: 8 }], spawn: [200, 340] });
    const { roll } = run(track, 4, (state) => ({ tilt: -state.vx / 160 }));
    expect(roll.status).toBe('rolling');
    expect(roll.x).toBeGreaterThan(600);
    expect(roll.y).toBeLessThan(400);
  });

  it('cuộn giấy không ra ngoài hai mép màn', () => {
    const { roll } = run(level({}), 3, () => ({ tilt: -1 }));
    expect(roll.x).toBeCloseTo(ROLL_RADIUS, 5);
  });
});

describe('luật trận', () => {
  it('đếm ngược rồi mới lăn; cưa đứng yên trong lúc đếm', () => {
    const match = new RollMatch(players(2));
    const events: MatchEvent[] = [];
    match.step(DT, events);
    expect(match.phase).toBe('countdown');
    expect(match.jump('p0')).toBe(false);
    for (let t = 0; t < COUNTDOWN_SECONDS; t += DT) match.step(DT, events);
    expect(events.filter((entry) => entry.event.type === 'tick')).toHaveLength(3);
    expect(events.some((entry) => entry.event.type === 'go')).toBe(true);
    expect(match.phase).toBe('playing');
    expect(match.world.time).toBeLessThan(0.1);
  });

  it('giao trước được nhiều điểm hơn; ai cũng giao xong thì hết màn và sang màn sau', () => {
    const match = new RollMatch(players(2));
    toPlaying(match);
    const goal = match.level.goal;
    const [first, second] = match.rollers;
    first!.roll.x = goal.x + goal.w / 2;
    first!.roll.y = goal.y + goal.h / 2;
    match.step(DT);
    second!.roll.x = goal.x + goal.w / 2;
    second!.roll.y = goal.y + goal.h / 2;
    const events = match.step(DT);
    expect(events.some((entry) => entry.event.type === 'levelEnd')).toBe(true);
    expect(match.phase).toBe('levelEnd');
    expect(first!.levelPoints).toBeGreaterThan(second!.levelPoints);
    expect(match.ranking()).toEqual(['p0', 'p1']);
    const earned = first!.levelPoints;
    for (let t = 0; t < LEVEL_END_SECONDS + 0.1; t += DT) match.step(DT);
    expect(match.levelIndex).toBe(1);
    expect(match.phase).toBe('countdown');
    // Điểm màn trước được cộng dồn sang màn sau.
    expect(first!.points).toBe(earned);
  });

  it('người đầu giao xong thì những người còn lại có thời gian ân hạn', () => {
    const match = new RollMatch(players(2));
    toPlaying(match);
    const goal = match.level.goal;
    match.rollers[0]!.roll.x = goal.x + goal.w / 2;
    match.rollers[0]!.roll.y = goal.y + goal.h / 2;
    match.step(DT);
    expect(match.view().graceLeft).toBeCloseTo(FINISH_GRACE_SECONDS, 0);
    for (let t = 0; t < FINISH_GRACE_SECONDS + 0.1 && match.phase === 'playing'; t += DT) match.step(DT);
    expect(match.phase).toBe('levelEnd');
  });

  it('chưa ai qua màn thì màn đó được chơi lại, không ai có điểm', () => {
    const match = new RollMatch(players(1));
    toPlaying(match);
    match.clock = 10_000;
    match.step(DT);
    expect(match.phase).toBe('levelEnd');
    expect(match.view().cleared).toBe(false);
    for (let t = 0; t < LEVEL_END_SECONDS + 0.1; t += DT) match.step(DT);
    expect(match.levelIndex).toBe(0);
    expect(match.rollers[0]!.points).toBe(0);
  });

  it('chủ phòng bấm màn tiếp hoặc chơi lại khi đang xem kết quả', () => {
    const match = new RollMatch(players(1), { level: 3 });
    expect(match.goTo('next')).toBe(false);
    toPlaying(match);
    const goal = match.level.goal;
    match.rollers[0]!.roll.x = goal.x + goal.w / 2;
    match.rollers[0]!.roll.y = goal.y + goal.h / 2;
    match.step(DT);
    expect(match.goTo('retry')).toBe(true);
    expect(match.levelIndex).toBe(3);
  });

  it('qua màn cuối là hết trận, xếp theo tổng điểm', () => {
    const match = new RollMatch(players(2), { level: LEVELS.length - 1 });
    toPlaying(match);
    const goal = match.level.goal;
    match.rollers[1]!.roll.x = goal.x + goal.w / 2;
    match.rollers[1]!.roll.y = goal.y + goal.h / 2;
    match.step(DT);
    match.clock = 10_000;
    const events = match.step(DT);
    expect(events.some((entry) => entry.event.type === 'matchEnd')).toBe(true);
    expect(match.phase).toBe('matchEnd');
    expect(match.ranking()[0]).toBe('p1');
    expect(match.goTo('next')).toBe(false);
  });

  it('sàn khởi động: giao xong thì lăn lại từ đầu, thêm/bớt người và đổi màn tự do', () => {
    const practice = new RollMatch([], { practice: true });
    practice.addRoller({ key: 'm1', name: 'An', color: '#ff5caf' });
    practice.addRoller({ key: 'm2', name: 'Bình', color: '#4cc9ff' });
    expect(practice.jump('m1')).toBe(true);
    const roller = practice.roller('m1')!;
    const goal = practice.level.goal;
    roller.roll.x = goal.x + goal.w / 2;
    roller.roll.y = goal.y + goal.h / 2;
    practice.advance(0.05);
    expect(roller.roll.status).toBe('done');
    for (let t = 0; t < 2; t += 0.05) practice.advance(0.05);
    expect(practice.roller('m1')!.roll.status).toBe('rolling');
    expect(practice.roller('m1')!.points).toBe(0);
    practice.removeRoller('m2');
    expect(practice.rollers.map((entry) => entry.key)).toEqual(['m1']);
    practice.setPracticeLevel(4);
    expect(practice.level.id).toBe(5);
    expect(practice.roller('m1')!.roll.x).toBe(LEVELS[4]!.spawn[0]);
  });
});

describe('lệnh qua mạng', () => {
  it('chỉ nhận lệnh nhảy có seq hợp lệ', () => {
    expect(parseRollCommand({ type: 'jump', seq: 'j1' })).toEqual({ type: 'jump', seq: 'j1' });
    expect(parseRollCommand({ type: 'jump' })).toBeNull();
    expect(parseRollCommand({ type: 'dash', seq: 'd1' })).toBeNull();
  });
});

describe('chế độ hiển thị: mỗi người một sân', () => {
  function playing(level: number, separate: boolean) {
    const match = new RollMatch(players(2), { level });
    match.setSeparate(separate);
    for (let t = 0; t < COUNTDOWN_SECONDS + 0.05; t += DT) match.step(DT);
    return match;
  }

  it('hai cuộn giấy không đẩy nhau khi mỗi người một sân, còn sân chung thì có', () => {
    const distance = (match: RollMatch) => {
      const [a, b] = match.rollers;
      return Math.hypot(a!.roll.x - b!.roll.x, a!.roll.y - b!.roll.y);
    };
    const shared = playing(0, false);
    const separate = playing(0, true);
    for (const match of [shared, separate]) {
      match.rollers[1]!.roll.x += 6;
      for (let i = 0; i < 20; i += 1) match.step(DT);
    }
    expect(distance(shared)).toBeGreaterThanOrEqual(ROLL_RADIUS * 2 - 1);
    expect(distance(separate)).toBeLessThan(ROLL_RADIUS);
  });

  it('mỗi người có bập bênh riêng: đứng hai đầu thì mỗi sân nghiêng một phía', () => {
    const seesaw = LEVELS[2]!.seesaws![0]!;
    const place = (match: RollMatch) => {
      const [left, right] = match.rollers;
      Object.assign(right!.roll, { x: seesaw.x + seesaw.length * 0.35, y: seesaw.y - 60, vx: 0, vy: 0 });
      Object.assign(left!.roll, { x: seesaw.x - seesaw.length * 0.35, y: seesaw.y - 60, vx: 0, vy: 0 });
      for (let t = 0; t < 1.2; t += DT) match.step(DT);
    };
    const separate = playing(2, true);
    place(separate);
    const [left, right] = separate.rollers;
    expect(separate.worldFor(right!).seesaws[0]!.angle).toBeGreaterThan(0.05);
    expect(separate.worldFor(left!).seesaws[0]!.angle).toBeLessThan(-0.05);
    // Sân chung: hai người đứng hai đầu thì gần như cân nhau.
    const shared = playing(2, false);
    place(shared);
    expect(Math.abs(shared.world.seesaws[0]!.angle)).toBeLessThan(Math.abs(separate.worldFor(right!).seesaws[0]!.angle));
  });

  it('đồng hồ của các sân riêng khớp với sân chung (cưa, bục trôi cùng nhịp)', () => {
    const match = playing(0, true);
    for (let i = 0; i < 100; i += 1) match.step(DT);
    for (const roller of match.rollers) expect(match.worldFor(roller).time).toBeCloseTo(match.world.time, 6);
  });
});
