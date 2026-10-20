/** Đơn vị màn chơi: cả màn vừa một khung 1600 × 900, trục y hướng xuống. */
export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 900;
export const ROLL_RADIUS = 24;

const GRAVITY = 1_500;
/** Nghiêng hết cỡ thì cuộn giấy tăng tốc ngần này dọc theo mặt sàn. */
const ROLL_ACCEL = 900;
const AIR_ACCEL = 380;
/** Lực cản lăn: tốc độ tối đa trên sàn phẳng ≈ ROLL_ACCEL / ROLL_DRAG. */
const ROLL_DRAG = 2.2;
const AIR_DRAG = 0.25;
const JUMP_SPEED = 560;
/** Vừa rời mép vẫn nhảy được trong ngần này giây cho đỡ ức. */
const COYOTE_SECONDS = 0.1;
const JUMP_BUFFER_SECONDS = 0.15;
const BOUNCE_SPEED = 1_100;
/** Quạt kéo vận tốc đi lên về `lift` với độ bám này, nên bay lên đều chứ không vọt ra khỏi màn. */
const FAN_GRIP = 6;
const SEESAW_TORQUE = 0.0045;
const SEESAW_DAMPING = 2.4;
const SEESAW_RESTORE = 1.2;
const FALL_LIMIT = WORLD_HEIGHT + 120;

export type Point = [number, number];

/** Bục tĩnh: một đoạn thẳng dày `t` (đầu tròn). `bouncy` là đệm nảy. */
export interface Platform { a: Point; b: Point; t?: number; bouncy?: boolean }
/** Bục di chuyển qua lại theo `move` trong `period` giây. */
export interface Mover { a: Point; b: Point; t?: number; move: Point; period: number; phase?: number }
/** Bập bênh quay quanh tâm (x, y) theo sức nặng của cuộn giấy đứng trên nó. */
export interface Seesaw { x: number; y: number; length: number; maxAngle?: number }
/** Lưỡi cưa: đứng yên, chạy qua lại theo `move`, hoặc quay vòng quanh tâm với bán kính `orbit`. */
export interface Saw { x: number; y: number; r: number; move?: Point; orbit?: number; period?: number; phase?: number }
export interface Zone { x: number; y: number; w: number; h: number }
/** Quạt thổi lên: trong vùng này cuộn giấy bay lên với tốc độ khoảng `lift`. */
export interface Fan extends Zone { lift: number }
/** Cờ: chạm vào thì chết sẽ sống lại ở đây. `route` là mốc bot đi tiếp từ cờ này. */
export interface Checkpoint { x: number; y: number; route: number }

export interface Level {
  id: number;
  name: string;
  hint: string;
  spawn: Point;
  goal: Zone;
  platforms: Platform[];
  movers?: Mover[];
  seesaws?: Seesaw[];
  saws?: Saw[];
  fans?: Fan[];
  water?: Zone[];
  checkpoints?: Checkpoint[];
  /** Đường đi cho bot (minh họa ở sảnh và test chứng minh màn qua được). */
  route: RouteStep[];
}

/**
 * Một mốc của bot. `board`: chờ bục di chuyển số này về sát chỗ xuất phát rồi bước lên.
 * `ride`: đứng yên trên bục tới khi bục đi được `until` (0..1) quãng đường.
 */
export interface RouteStep {
  x: number;
  y?: number;
  jump?: boolean;
  wait?: number;
  board?: number;
  ride?: { mover: number; until: number };
}

/** 0..1: bục đã đi được bao nhiêu phần quãng đường `move`. */
export function moverProgress(mover: Mover, time: number): number {
  return 0.5 - 0.5 * Math.cos(((time / mover.period) + (mover.phase ?? 0)) * Math.PI * 2);
}

export type RollStatus = 'ready' | 'rolling' | 'dead' | 'done';
export type DeathCause = 'saw' | 'water' | 'fall';
export type RollEvent =
  | { type: 'jump' }
  | { type: 'land'; strength: number }
  | { type: 'bounce' }
  | { type: 'bump' }
  | { type: 'die'; cause: DeathCause }
  | { type: 'respawn' }
  | { type: 'checkpoint'; index: number }
  | { type: 'goal' };

export interface RollState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Góc xoay để vẽ, tích lũy theo quãng đường lăn. */
  angle: number;
  status: RollStatus;
  grounded: boolean;
  /** Pháp tuyến mặt sàn đang đứng (hướng lên). */
  normal: Point;
  airTime: number;
  jumpBuffer: number;
  deadTimer: number;
  deathCause: DeathCause | null;
  deaths: number;
  checkpoint: number;
  respawn: Point;
  finishTime: number | null;
}

export interface SeesawState { angle: number; velocity: number }

export interface WorldState {
  level: Level;
  time: number;
  seesaws: SeesawState[];
}

export function createRoll(level: Level): RollState {
  return {
    x: level.spawn[0], y: level.spawn[1], vx: 0, vy: 0, angle: 0, status: 'ready', grounded: false,
    normal: [0, -1], airTime: 0, jumpBuffer: 0, deadTimer: 0, deathCause: null, deaths: 0,
    checkpoint: -1, respawn: [...level.spawn], finishTime: null,
  };
}

export function createWorld(level: Level): WorldState {
  return { level, time: 0, seesaws: (level.seesaws ?? []).map(() => ({ angle: 0, velocity: 0 })) };
}

/** Vị trí hiện tại của bục di chuyển (dao động hình sin giữa chỗ gốc và chỗ gốc + move). */
export function moverOffset(mover: Mover, time: number): Point {
  const t = moverProgress(mover, time);
  return [mover.move[0] * t, mover.move[1] * t];
}

export function sawPosition(saw: Saw, time: number): Point {
  const cycle = ((time / (saw.period ?? 1)) + (saw.phase ?? 0)) * Math.PI * 2;
  if (saw.orbit) return [saw.x + Math.cos(cycle) * saw.orbit, saw.y + Math.sin(cycle) * saw.orbit];
  if (saw.move) {
    const t = 0.5 - 0.5 * Math.cos(cycle);
    return [saw.x + saw.move[0] * t, saw.y + saw.move[1] * t];
  }
  return [saw.x, saw.y];
}

/** Hai đầu tấm bập bênh ở góc hiện tại. */
export function seesawEnds(seesaw: Seesaw, state: SeesawState): [Point, Point] {
  const half = seesaw.length / 2;
  const dx = Math.cos(state.angle) * half;
  const dy = Math.sin(state.angle) * half;
  return [[seesaw.x - dx, seesaw.y - dy], [seesaw.x + dx, seesaw.y + dy]];
}

interface Surface { a: Point; b: Point; t: number; velocity: Point; bouncy: boolean; seesaw: number }

function surfaces(world: WorldState): Surface[] {
  const { level, time } = world;
  const list: Surface[] = level.platforms.map((platform) => ({ a: platform.a, b: platform.b, t: platform.t ?? 20, velocity: [0, 0], bouncy: Boolean(platform.bouncy), seesaw: -1 }));
  for (const mover of level.movers ?? []) {
    const [ox, oy] = moverOffset(mover, time);
    const [nx, ny] = moverOffset(mover, time + 1 / 120);
    list.push({
      a: [mover.a[0] + ox, mover.a[1] + oy], b: [mover.b[0] + ox, mover.b[1] + oy], t: mover.t ?? 20,
      velocity: [(nx - ox) * 120, (ny - oy) * 120], bouncy: false, seesaw: -1,
    });
  }
  (level.seesaws ?? []).forEach((seesaw, index) => {
    const [a, b] = seesawEnds(seesaw, world.seesaws[index]!);
    list.push({ a, b, t: 18, velocity: [0, 0], bouncy: false, seesaw: index });
  });
  return list;
}

function closestOnSegment(px: number, py: number, a: Point, b: Point): { x: number; y: number; along: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const along = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / length));
  return { x: a[0] + dx * along, y: a[1] + dy * along, along };
}

function inside(zone: Zone, x: number, y: number, margin = 0): boolean {
  return x > zone.x - margin && x < zone.x + zone.w + margin && y > zone.y - margin && y < zone.y + zone.h + margin;
}

export function queueJump(roll: RollState): void {
  roll.jumpBuffer = JUMP_BUFFER_SECONDS;
}

/** Bước các vật thể chung của màn (bập bênh) theo sức nặng của mọi cuộn giấy đang đứng trên chúng. */
export function stepWorld(world: WorldState, rolls: RollState[], dt: number): void {
  world.time += dt;
  (world.level.seesaws ?? []).forEach((seesaw, index) => {
    const state = world.seesaws[index]!;
    let torque = 0;
    const [a, b] = seesawEnds(seesaw, state);
    for (const roll of rolls) {
      if (roll.status !== 'rolling') continue;
      const closest = closestOnSegment(roll.x, roll.y, a, b);
      if (Math.hypot(roll.x - closest.x, roll.y - closest.y) > ROLL_RADIUS + 14) continue;
      // Đòn bẩy: cuộn giấy càng xa tâm thì bập bênh càng nghiêng về phía đó.
      torque += (closest.along - 0.5) * seesaw.length * SEESAW_TORQUE;
    }
    const max = ((seesaw.maxAngle ?? 26) * Math.PI) / 180;
    state.velocity += (torque - state.angle * SEESAW_RESTORE - state.velocity * SEESAW_DAMPING) * dt * 6;
    state.angle += state.velocity * dt;
    if (Math.abs(state.angle) > max) {
      state.angle = Math.sign(state.angle) * max;
      state.velocity = 0;
    }
  });
}

/**
 * Một bước vật lý cho một cuộn giấy. `tilt` -1..1 là độ nghiêng tấm bìa (điện thoại):
 * trên sàn thì đẩy cuộn giấy lăn dọc mặt sàn, trên không thì chỉ lái nhẹ.
 */
export function stepRoll(roll: RollState, tilt: number, world: WorldState, dt: number, events: RollEvent[]): void {
  const level = world.level;
  if (roll.status === 'ready' || roll.status === 'done') return;
  if (roll.status === 'dead') {
    roll.deadTimer -= dt;
    if (roll.deadTimer <= 0) {
      Object.assign(roll, { status: 'rolling', x: roll.respawn[0], y: roll.respawn[1], vx: 0, vy: 0, grounded: false, airTime: 0 });
      events.push({ type: 'respawn' });
    }
    return;
  }

  const input = Math.max(-1, Math.min(1, Number.isFinite(tilt) ? tilt : 0));
  roll.jumpBuffer = Math.max(0, roll.jumpBuffer - dt);
  roll.airTime = roll.grounded ? 0 : roll.airTime + dt;

  if (roll.grounded) {
    // Đẩy dọc mặt sàn (tiếp tuyến luôn hướng sang phải).
    const [nx, ny] = roll.normal;
    const tx = -ny;
    const ty = nx;
    roll.vx += tx * input * ROLL_ACCEL * dt;
    roll.vy += ty * input * ROLL_ACCEL * dt;
    const decay = Math.exp(-ROLL_DRAG * dt);
    // Chỉ cản theo phương dọc sàn; phương pháp tuyến do va chạm xử lý.
    const along = roll.vx * tx + roll.vy * ty;
    roll.vx -= tx * along * (1 - decay);
    roll.vy -= ty * along * (1 - decay);
  } else {
    roll.vx += input * AIR_ACCEL * dt;
    roll.vx *= Math.exp(-AIR_DRAG * dt);
  }
  roll.vy += GRAVITY * dt;

  for (const fan of level.fans ?? []) {
    if (inside(fan, roll.x, roll.y)) roll.vy += (-fan.lift - GRAVITY / FAN_GRIP - roll.vy) * FAN_GRIP * dt;
  }

  if (roll.jumpBuffer > 0 && (roll.grounded || roll.airTime < COYOTE_SECONDS)) {
    roll.vy = Math.min(roll.vy, 0) - JUMP_SPEED;
    roll.jumpBuffer = 0;
    roll.grounded = false;
    roll.airTime = COYOTE_SECONDS;
    events.push({ type: 'jump' });
  }

  roll.x += roll.vx * dt;
  roll.y += roll.vy * dt;
  const wasGrounded = roll.grounded;
  const impact = roll.vy;
  roll.grounded = false;

  const list = surfaces(world);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const surface of list) {
      const closest = closestOnSegment(roll.x, roll.y, surface.a, surface.b);
      let dx = roll.x - closest.x;
      let dy = roll.y - closest.y;
      let distance = Math.hypot(dx, dy);
      const reach = ROLL_RADIUS + surface.t / 2;
      if (distance >= reach) continue;
      if (distance < 1e-6) {
        dx = 0;
        dy = -1;
        distance = 1;
      }
      const nx = dx / distance;
      const ny = dy / distance;
      roll.x += nx * (reach - distance);
      roll.y += ny * (reach - distance);
      const relativeX = roll.vx - surface.velocity[0];
      const relativeY = roll.vy - surface.velocity[1];
      const into = relativeX * nx + relativeY * ny;
      if (into < 0) {
        const restitution = surface.bouncy ? 0 : 0.05;
        roll.vx -= nx * into * (1 + restitution);
        roll.vy -= ny * into * (1 + restitution);
      }
      if (ny < -0.45) {
        roll.grounded = true;
        roll.normal = [nx, ny];
        if (surface.bouncy) {
          roll.vy = -BOUNCE_SPEED;
          roll.grounded = false;
          events.push({ type: 'bounce' });
        } else if (pass === 0) {
          // Đứng trên bục di chuyển thì đi theo bục.
          roll.x += surface.velocity[0] * dt;
          roll.y += Math.max(0, surface.velocity[1]) * dt;
        }
      }
    }
  }
  if (roll.grounded && !wasGrounded && impact > 420) events.push({ type: 'land', strength: Math.min(1, impact / 1_200) });

  roll.x = Math.max(ROLL_RADIUS, Math.min(WORLD_WIDTH - ROLL_RADIUS, roll.x));
  roll.angle += (roll.vx * dt) / ROLL_RADIUS;

  for (const saw of level.saws ?? []) {
    const [sx, sy] = sawPosition(saw, world.time);
    // Chạm mép răng cưa mới tính, chừa chút cho đỡ oan.
    if (Math.hypot(roll.x - sx, roll.y - sy) < saw.r + ROLL_RADIUS * 0.7) return kill(roll, 'saw', events);
  }
  for (const water of level.water ?? []) {
    if (inside(water, roll.x, roll.y, -ROLL_RADIUS * 0.3)) return kill(roll, 'water', events);
  }
  if (roll.y > FALL_LIMIT) return kill(roll, 'fall', events);

  (level.checkpoints ?? []).forEach((checkpoint, index) => {
    if (index > roll.checkpoint && Math.hypot(roll.x - checkpoint.x, roll.y - checkpoint.y) < 70) {
      roll.checkpoint = index;
      roll.respawn = [checkpoint.x, checkpoint.y - 10];
      events.push({ type: 'checkpoint', index });
    }
  });
  if (inside(level.goal, roll.x, roll.y)) {
    roll.status = 'done';
    roll.finishTime = world.time;
    events.push({ type: 'goal' });
  }
}

function kill(roll: RollState, cause: DeathCause, events: RollEvent[]): void {
  roll.status = 'dead';
  roll.deathCause = cause;
  roll.deadTimer = 1.1;
  roll.deaths += 1;
  roll.vx = 0;
  roll.vy = 0;
  events.push({ type: 'die', cause });
}

/** Hai cuộn giấy chạm nhau thì đẩy nhẹ ra (vui nhưng không phá game). */
export function collideRolls(rolls: RollState[], events: Array<{ index: number; event: RollEvent }>): void {
  for (let i = 0; i < rolls.length; i += 1) {
    for (let j = i + 1; j < rolls.length; j += 1) {
      const a = rolls[i]!;
      const b = rolls[j]!;
      if (a.status !== 'rolling' || b.status !== 'rolling') continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= ROLL_RADIUS * 2 || distance < 1e-6) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      const push = (ROLL_RADIUS * 2 - distance) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (approach <= 0) continue;
      a.vx -= nx * approach * 0.9;
      a.vy -= ny * approach * 0.9;
      b.vx += nx * approach * 0.9;
      b.vy += ny * approach * 0.9;
      if (approach > 160) events.push({ index: i, event: { type: 'bump' } });
    }
  }
}
