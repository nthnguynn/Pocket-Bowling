import { describe, expect, it } from 'vitest';
import { parseControllerCommand } from '@pocket/party-kit';
import { botDecision } from '../src/bot';
import { parseSumoCommand } from '../src/protocol';
import {
  ARENA_RADIUS, createFighter, DASH_COOLDOWN, FIGHTER_RADIUS, queueDash, setInput, stepWorld,
  type Fighter, type SumoEvent, type WorldState,
} from '../src/physics';
import {
  COUNTDOWN_SECONDS, CRUMBLE_EVERY, FIRST_CRUMBLE, MIN_RADIUS, RING_WIDTH, SumoMatch, WIN_ROUNDS, type MatchEvent,
} from '../src/SumoMatch';

const DT = 1 / 120;

function world(fighters: Fighter[], radius = 10_000): WorldState {
  return { fighters, radius, rules: { ice: false, bumpers: [] }, time: 0 };
}

function run(state: WorldState, seconds: number, each?: () => void): SumoEvent[] {
  const events: SumoEvent[] = [];
  for (let t = 0; t < seconds; t += DT) {
    each?.();
    state.time += DT;
    stepWorld(state, DT, events);
  }
  return events;
}

function players(count: number, bots = false) {
  return Array.from({ length: count }, (_, index) => ({ key: `p${index}`, name: `P${index}`, color: '#ff5caf', botSkill: bots ? 1 - index * 0.2 : undefined }));
}

/** Chạy trận tới khi vào giai đoạn đấu. */
function toFight(match: SumoMatch): MatchEvent[] {
  const events: MatchEvent[] = [];
  for (let t = 0; t < COUNTDOWN_SECONDS + 0.1; t += DT) match.step(DT, events);
  return events;
}

describe('vật lý sàn sumo', () => {
  it('kéo cần thì chạy tới tốc độ tối đa, buông tay thì dừng nhanh', () => {
    const fighter = createFighter('a', 'A', '#fff');
    const state = world([fighter]);
    setInput(fighter, 1, 0);
    run(state, 1);
    expect(fighter.vx).toBeGreaterThan(190);
    expect(fighter.vx).toBeLessThan(230);
    setInput(fighter, 0, 0);
    run(state, 0.8);
    expect(Math.abs(fighter.vx)).toBeLessThan(5);
  });

  it('input được chuẩn hóa: kéo chéo không nhanh hơn kéo thẳng', () => {
    const fighter = createFighter('a', 'A', '#fff');
    setInput(fighter, 5, 5);
    expect(Math.hypot(fighter.input.x, fighter.input.y)).toBeCloseTo(1, 5);
    setInput(fighter, Number.NaN, 0);
    expect(Math.hypot(fighter.input.x, fighter.input.y)).toBeCloseTo(1, 5);
  });

  it('húc trúng thì đối thủ văng xa, người húc gần như đứng lại', () => {
    const attacker = createFighter('a', 'A', '#fff');
    const target = createFighter('b', 'B', '#fff');
    attacker.x = -70;
    const state = world([attacker, target]);
    queueDash(attacker, 1, 0);
    const events = run(state, 2);
    const bump = events.find((event) => event.type === 'bump');
    expect(bump).toMatchObject({ key: 'a', other: 'b' });
    expect(target.x).toBeGreaterThan(150);
    expect(attacker.x).toBeLessThan(0);
    expect(target.lastHitBy).toBe('a');
  });

  it('hai người cùng húc trực diện thì cả hai bật ngược', () => {
    const a = createFighter('a', 'A', '#fff');
    const b = createFighter('b', 'B', '#fff');
    a.x = -80;
    b.x = 80;
    const state = world([a, b]);
    queueDash(a, 1, 0);
    queueDash(b, -1, 0);
    const events = run(state, 1.5);
    expect(events.some((event) => event.type === 'clash')).toBe(true);
    expect(a.x).toBeLessThan(-80);
    expect(b.x).toBeGreaterThan(80);
  });

  it('húc có hồi chiêu; lệnh tới sớm một chút vẫn được giữ lại', () => {
    const fighter = createFighter('a', 'A', '#fff');
    const state = world([fighter]);
    expect(queueDash(fighter, 1, 0)).toBe(true);
    run(state, DT);
    expect(fighter.dashCooldown).toBeGreaterThan(DASH_COOLDOWN - 0.05);
    expect(queueDash(fighter, 1, 0)).toBe(false);
    run(state, DASH_COOLDOWN - 0.15);
    expect(queueDash(fighter, 0, 1)).toBe(true);
    const events = run(state, 0.3);
    expect(events.filter((event) => event.type === 'dash')).toHaveLength(1);
  });

  it('ra khỏi mép thì rơi, được tính KO cho người húc gần nhất, rồi hóa hồn ma', () => {
    const attacker = createFighter('a', 'A', '#fff');
    const target = createFighter('b', 'B', '#fff');
    attacker.x = 60;
    target.x = 130;
    const state = world([attacker, target], 200);
    queueDash(attacker, 1, 0);
    const events = run(state, 2);
    expect(events.find((event) => event.type === 'fall')).toMatchObject({ key: 'b', other: 'a' });
    expect(target.status).toBe('ghost');
    expect(attacker.status).toBe('alive');
  });

  it('hồn ma thổi được người còn sống nhưng không va chạm', () => {
    const ghost = createFighter('g', 'G', '#fff');
    const target = createFighter('t', 'T', '#fff');
    ghost.status = 'ghost';
    ghost.x = -FIGHTER_RADIUS;
    const state = world([ghost, target]);
    run(state, 0.2);
    expect(target.x).toBeCloseTo(0, 5);
    queueDash(ghost, 1, 0);
    const events = run(state, 0.6);
    expect(events.some((event) => event.type === 'puff')).toBe(true);
    expect(target.x).toBeGreaterThan(30);
    expect(target.lastHitBy).toBe('g');
  });
});

describe('luật trận đấu', () => {
  it('đếm ngược rồi mới cho đấu, mọi người đứng cách đều trên sàn', () => {
    const match = new SumoMatch(players(4), { seed: 3 });
    expect(match.phase).toBe('countdown');
    expect(match.dash('p0', 1, 0)).toBe(false);
    const events = toFight(match);
    expect(events.filter((event) => event.type === 'tick').map((event) => (event as { value: number }).value)).toEqual([3, 2, 1]);
    expect(events.some((event) => event.type === 'go')).toBe(true);
    expect(match.phase).toBe('fight');
    const distances = match.fighters.map((fighter) => Math.hypot(fighter.x, fighter.y));
    distances.forEach((distance) => expect(distance).toBeCloseTo(distances[0]!, 5));
    expect(distances[0]).toBeLessThan(ARENA_RADIUS - FIGHTER_RADIUS * 2);
  });

  it('8 người vào sàn vẫn đứng tách nhau, không chồng lên nhau', () => {
    const match = new SumoMatch(players(8), { seed: 1 });
    const fighters = match.fighters;
    for (let i = 0; i < fighters.length; i += 1) {
      for (let j = i + 1; j < fighters.length; j += 1) {
        expect(Math.hypot(fighters[i]!.x - fighters[j]!.x, fighters[i]!.y - fighters[j]!.y)).toBeGreaterThan(FIGHTER_RADIUS * 4);
      }
    }
  });

  it('vòng ngoài được cảnh báo trước rồi mới sụp, sàn không nhỏ hơn mức tối thiểu trước giờ phụ', () => {
    const match = new SumoMatch(players(2), { seed: 3 });
    toFight(match);
    const events: MatchEvent[] = [];
    for (let t = 0; t < FIRST_CRUMBLE + CRUMBLE_EVERY * 0.5; t += DT) match.step(DT, events);
    const warn = events.findIndex((event) => event.type === 'warn');
    const crumble = events.findIndex((event) => event.type === 'crumble');
    expect(warn).toBeGreaterThanOrEqual(0);
    expect(crumble).toBeGreaterThan(warn);
    expect(match.world.radius).toBe(ARENA_RADIUS - RING_WIDTH);
    for (let t = 0; t < CRUMBLE_EVERY * 6; t += DT) {
      match.step(DT);
      if (match.phase !== 'fight') break;
      expect(match.world.radius).toBeGreaterThanOrEqual(MIN_RADIUS);
    }
  });

  it('người cuối cùng trụ lại thắng vòng; đủ số vòng thì thắng trận', () => {
    const match = new SumoMatch(players(2), { seed: 5 });
    for (let round = 1; round <= WIN_ROUNDS; round += 1) {
      toFight(match);
      const loser = match.fighter('p1')!;
      loser.x = ARENA_RADIUS + 10;
      const events: MatchEvent[] = [];
      match.step(DT, events);
      expect(events.find((event) => event.type === 'roundEnd')).toMatchObject({ winner: 'p0' });
      expect(match.phase).toBe('roundEnd');
      for (let t = 0; t < 4 && match.phase === 'roundEnd'; t += DT) match.step(DT, events);
      if (round < WIN_ROUNDS) expect(match.round).toBe(round + 1);
    }
    expect(match.phase).toBe('matchEnd');
    expect(match.matchWinner).toBe('p0');
    expect(match.score('p0').wins).toBe(WIN_ROUNDS);
    expect(match.ranking()).toEqual(['p0', 'p1']);
  });

  it('cùng rơi một lúc thì hòa, không ai được điểm', () => {
    const match = new SumoMatch(players(2), { seed: 5 });
    toFight(match);
    match.fighters.forEach((fighter, index) => { fighter.x = (index ? 1 : -1) * (ARENA_RADIUS + 10); });
    const events: MatchEvent[] = [];
    match.step(DT, events);
    expect(events.find((event) => event.type === 'roundEnd')).toMatchObject({ winner: null });
    expect(match.score('p0').wins + match.score('p1').wins).toBe(0);
  });

  it('các vòng đổi kiểu sàn: gỗ, băng, cột nảy', () => {
    const match = new SumoMatch(players(2), { seed: 9 });
    const variants: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      variants.push(match.variant);
      toFight(match);
      match.fighter('p1')!.x = ARENA_RADIUS + 10;
      for (let t = 0; t < 5 && match.round === round + 1; t += DT) match.step(DT);
    }
    expect(variants).toEqual(['classic', 'ice', 'bumpers']);
    expect(match.world.rules.bumpers).toHaveLength(3);
  });

  it('sàn khởi động: rơi thì xuất hiện lại, thêm/bớt người tự do', () => {
    const practice = new SumoMatch([], { practice: true, seed: 2 });
    practice.addFighter({ key: 'm1', name: 'An', color: '#ff5caf' });
    practice.addFighter({ key: 'm2', name: 'Bình', color: '#4cc9ff' });
    const fighter = practice.fighter('m1')!;
    fighter.x = ARENA_RADIUS + 30;
    const events = practice.advance(0.05);
    for (let t = 0; t < 1.2; t += 0.05) events.push(...practice.advance(0.05));
    expect(events.some((event) => event.type === 'fall')).toBe(true);
    expect(events.some((event) => event.type === 'spawn' && event.key === 'm1')).toBe(true);
    expect(fighter.status).toBe('alive');
    expect(Math.hypot(fighter.x, fighter.y)).toBeLessThan(ARENA_RADIUS);
    practice.removeFighter('m2');
    expect(practice.fighters.map((entry) => entry.key)).toEqual(['m1']);
    expect(practice.dash('m1', 1, 0)).toBe(true);
  });

  it('điện thoại rớt mạng thì bot đánh hộ, nối lại thì trả quyền điều khiển', () => {
    const match = new SumoMatch(players(2), { seed: 4 });
    toFight(match);
    match.setAutopilot('p1', true);
    expect(match.dash('p1', 1, 0)).toBe(false);
    for (let t = 0; t < 1; t += DT) match.step(DT);
    expect(Math.hypot(match.fighter('p1')!.input.x, match.fighter('p1')!.input.y)).toBeGreaterThan(0);
    match.setAutopilot('p1', false);
    expect(match.fighter('p1')!.input).toEqual({ x: 0, y: 0 });
  });

  it('trận toàn bot luôn kết thúc với một nhà vô địch', () => {
    for (let seed = 1; seed <= 8; seed += 1) {
      const match = new SumoMatch(players(4, true), { seed });
      for (let t = 0; t < 900 && match.phase !== 'matchEnd'; t += 1 / 30) match.advance(1 / 30);
      expect(match.phase).toBe('matchEnd');
      expect(match.score(match.matchWinner!).wins).toBe(WIN_ROUNDS);
    }
  });

  it('bot giỏi tránh xa mép khi không có ai để đẩy', () => {
    const bot = createFighter('b', 'Bot', '#fff', 1);
    bot.x = ARENA_RADIUS - 20;
    const decision = botDecision(bot, world([bot], ARENA_RADIUS), () => 0.5);
    expect(decision.x).toBeLessThan(0);
    expect(decision.dash).toBe(false);
  });
});

describe('lệnh húc qua mạng', () => {
  it('nhận lệnh húc hợp lệ và kẹp hướng vào [-1, 1]', () => {
    expect(parseControllerCommand(JSON.stringify({ type: 'dash', seq: 'd1', x: 4, y: -0.5 }), parseSumoCommand)).toEqual({ type: 'dash', seq: 'd1', x: 1, y: -0.5 });
  });

  it('chặn lệnh húc thiếu hướng hoặc sai kiểu', () => {
    expect(parseControllerCommand(JSON.stringify({ type: 'dash', seq: 'd1', x: 'left', y: 0 }), parseSumoCommand)).toBeNull();
    expect(parseControllerCommand(JSON.stringify({ type: 'dash', x: 0, y: 0 }), parseSumoCommand)).toBeNull();
  });
});
