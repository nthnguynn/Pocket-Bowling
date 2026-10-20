/** Đơn vị sàn đấu: tâm sàn ở (0, 0), bán kính ban đầu ARENA_RADIUS. */
export const ARENA_RADIUS = 300;
export const FIGHTER_RADIUS = 24;
export const BUMPER_RADIUS = 28;

const ACCELERATION = 1_150;
/** Lực cản khi tự chạy: tốc độ tối đa = ACCELERATION / DRAG ≈ 215. */
const DRAG = 5.4;
const ICE_DRAG = 1.5;
/** Bị húc thì trượt xa hơn: lực cản thấp trong lúc choáng. */
const STUN_DRAG = 1.9;
const STUN_CONTROL = 0.3;
const RESTITUTION = 0.9;
/** Cú va chạm nào cũng nảy thêm một chút cho "đã tay". */
const BUMP_IMPULSE = 70;

export const DASH_SPEED = 520;
export const DASH_SECONDS = 0.2;
export const DASH_COOLDOWN = 1.1;
const DASH_DRAG = 1.2;
/** Lúc húc, người húc nặng gấp ngần này để không bị bật ngược. */
const DASH_MASS = 3;
export const DASH_KNOCKBACK = 540;
const HIT_STUN = 0.38;

export const GHOST_SPEED = 260;
export const PUFF_COOLDOWN = 2.6;
export const PUFF_RANGE = 95;
const PUFF_KNOCKBACK = 230;
const FALL_SECONDS = 0.75;
/** Cú va gần nhất trong ngần này giây thì được tính là người hất văng. */
const KO_CREDIT_SECONDS = 2.5;

export type FighterStatus = 'alive' | 'falling' | 'ghost';

export interface Fighter {
  key: string;
  name: string;
  color: string;
  bot: boolean;
  botSkill: number;
  /** Bot chơi hộ khi điện thoại của người này mất kết nối giữa ván. */
  autopilot: boolean;
  status: FighterStatus;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Hướng mặt (radian), để vẽ mắt nhìn theo. */
  facing: number;
  input: { x: number; y: number };
  dash: number;
  dashCooldown: number;
  /** Lệnh húc tới sớm hơn hồi chiêu một chút vẫn được giữ lại. */
  dashBuffer: { x: number; y: number; timer: number } | null;
  stun: number;
  fallTimer: number;
  lastHitBy: string | null;
  lastHitAt: number;
  /** Giây kể từ cú va gần nhất, để vẽ méo hình. */
  impact: number;
  /** Lúc điện thoại vừa có người chạm vào (để TV sáng vòng dưới chân). */
  touchedAt: number;
}

export interface Bumper { x: number; y: number }

export interface ArenaRules {
  ice: boolean;
  bumpers: Bumper[];
}

export type SumoEventType = 'bump' | 'clash' | 'dash' | 'fall' | 'puff' | 'bumper';

export interface SumoEvent {
  type: SumoEventType;
  key: string;
  /** Người còn lại trong cú va / người được tính KO. */
  other?: string;
  x: number;
  y: number;
  strength: number;
}

export function createFighter(key: string, name: string, color: string, botSkill?: number): Fighter {
  return {
    key, name, color, bot: botSkill !== undefined, botSkill: botSkill ?? 1, autopilot: false,
    status: 'alive', x: 0, y: 0, vx: 0, vy: 0, facing: Math.PI / 2, input: { x: 0, y: 0 },
    dash: 0, dashCooldown: 0, dashBuffer: null, stun: 0, fallTimer: 0, lastHitBy: null, lastHitAt: -Infinity,
    impact: 10, touchedAt: -Infinity,
  };
}

/** Đặt mọi người cách đều trên một vòng tròn, mặt hướng vào tâm. */
export function placeInCircle(fighters: Fighter[], radius: number, offset = -Math.PI / 2): void {
  fighters.forEach((fighter, index) => {
    const angle = offset + (index / Math.max(1, fighters.length)) * Math.PI * 2;
    Object.assign(fighter, {
      x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0,
      facing: angle + Math.PI, status: 'alive', dash: 0, dashCooldown: 0, dashBuffer: null, stun: 0,
      fallTimer: 0, lastHitBy: null, lastHitAt: -Infinity, impact: 10,
    });
  });
}

function normalize(x: number, y: number, max = 1): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (length <= max || length < 1e-9) return { x, y };
  return { x: (x / length) * max, y: (y / length) * max };
}

export function setInput(fighter: Fighter, x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  fighter.input = normalize(x, y);
}

/** Xếp hàng một cú húc (hoặc cú thổi nếu đã là hồn ma); hướng 0 thì húc theo hướng mặt. */
export function queueDash(fighter: Fighter, x: number, y: number): boolean {
  if (fighter.status === 'falling') return false;
  const cooldown = fighter.dashCooldown;
  if (cooldown > 0.2) return false;
  const length = Math.hypot(x, y);
  const direction = length > 0.15
    ? { x: x / length, y: y / length }
    : { x: Math.cos(fighter.facing), y: Math.sin(fighter.facing) };
  fighter.dashBuffer = { ...direction, timer: 0.22 };
  return true;
}

export interface WorldState {
  fighters: Fighter[];
  radius: number;
  rules: ArenaRules;
  time: number;
}

/**
 * Một bước vật lý cố định. Sàn là hình tròn bán kính `world.radius`;
 * tâm người chơi ra ngoài mép là rơi. Người đã rơi thành hồn ma, bay tự do và thổi được người còn sống.
 */
export function stepWorld(world: WorldState, dt: number, events: SumoEvent[]): void {
  const { fighters, rules } = world;
  // Bước trước va chạm để mọi người cùng di chuyển rồi mới tách nhau ra.
  for (const fighter of fighters) stepFighter(fighter, world, dt, events);

  const alive = fighters.filter((fighter) => fighter.status === 'alive');
  for (let i = 0; i < alive.length; i += 1) {
    for (let j = i + 1; j < alive.length; j += 1) collide(alive[i]!, alive[j]!, world.time, events);
    for (const bumper of rules.bumpers) collideBumper(alive[i]!, bumper, events);
  }

  for (const fighter of alive) {
    if (Math.hypot(fighter.x, fighter.y) <= world.radius) continue;
    fighter.status = 'falling';
    fighter.fallTimer = FALL_SECONDS;
    fighter.dash = 0;
    fighter.dashBuffer = null;
    const credited = fighter.lastHitBy && world.time - fighter.lastHitAt < KO_CREDIT_SECONDS ? fighter.lastHitBy : undefined;
    events.push({ type: 'fall', key: fighter.key, other: credited, x: fighter.x, y: fighter.y, strength: 1 });
  }
}

function stepFighter(fighter: Fighter, world: WorldState, dt: number, events: SumoEvent[]): void {
  fighter.impact += dt;
  fighter.dashCooldown = Math.max(0, fighter.dashCooldown - dt);
  if (fighter.status === 'falling') {
    fighter.fallTimer -= dt;
    // Vẫn trôi theo đà một chút khi rơi khỏi mép.
    fighter.x += fighter.vx * dt * 0.5;
    fighter.y += fighter.vy * dt * 0.5;
    if (fighter.fallTimer <= 0) {
      fighter.status = 'ghost';
      fighter.vx = 0;
      fighter.vy = 0;
      fighter.dashCooldown = PUFF_COOLDOWN * 0.5;
    }
    return;
  }

  const buffer = fighter.dashBuffer;
  if (buffer) {
    buffer.timer -= dt;
    if (fighter.dashCooldown === 0) {
      fighter.dashBuffer = null;
      if (fighter.status === 'ghost') puff(fighter, world, events);
      else {
        fighter.vx = buffer.x * DASH_SPEED;
        fighter.vy = buffer.y * DASH_SPEED;
        fighter.dash = DASH_SECONDS;
        fighter.dashCooldown = DASH_COOLDOWN;
        fighter.stun = 0;
        fighter.facing = Math.atan2(buffer.y, buffer.x);
        events.push({ type: 'dash', key: fighter.key, x: fighter.x, y: fighter.y, strength: 1 });
      }
    } else if (buffer.timer <= 0) {
      fighter.dashBuffer = null;
    }
  }

  if (fighter.status === 'ghost') {
    // Hồn ma lướt nhẹ theo tay cầm, không va chạm với ai.
    const targetX = fighter.input.x * GHOST_SPEED;
    const targetY = fighter.input.y * GHOST_SPEED;
    fighter.vx += (targetX - fighter.vx) * Math.min(1, dt * 6);
    fighter.vy += (targetY - fighter.vy) * Math.min(1, dt * 6);
    fighter.x += fighter.vx * dt;
    fighter.y += fighter.vy * dt;
    const limit = ARENA_RADIUS + 60;
    const distance = Math.hypot(fighter.x, fighter.y);
    if (distance > limit) {
      fighter.x *= limit / distance;
      fighter.y *= limit / distance;
    }
    if (Math.hypot(fighter.input.x, fighter.input.y) > 0.1) fighter.facing = Math.atan2(fighter.input.y, fighter.input.x);
    return;
  }

  fighter.stun = Math.max(0, fighter.stun - dt);
  let drag: number;
  if (fighter.dash > 0) {
    fighter.dash = Math.max(0, fighter.dash - dt);
    drag = DASH_DRAG;
  } else {
    const control = fighter.stun > 0 ? STUN_CONTROL : 1;
    fighter.vx += fighter.input.x * ACCELERATION * control * dt;
    fighter.vy += fighter.input.y * ACCELERATION * control * dt;
    drag = fighter.stun > 0 ? STUN_DRAG : world.rules.ice ? ICE_DRAG : DRAG;
    if (world.rules.ice) {
      // Sàn băng: vẫn lái được nhưng trượt dài, tốc độ tối đa giữ gần như cũ.
      const speed = Math.hypot(fighter.vx, fighter.vy);
      if (speed > 240) {
        fighter.vx *= 240 / speed;
        fighter.vy *= 240 / speed;
      }
    }
  }
  const decay = Math.exp(-drag * dt);
  fighter.vx *= decay;
  fighter.vy *= decay;
  fighter.x += fighter.vx * dt;
  fighter.y += fighter.vy * dt;
  if (Math.hypot(fighter.input.x, fighter.input.y) > 0.2 && fighter.dash === 0 && fighter.stun === 0) {
    fighter.facing = turnToward(fighter.facing, Math.atan2(fighter.input.y, fighter.input.x), dt * 14);
  }
}

function turnToward(current: number, target: number, amount: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + Math.max(-amount, Math.min(amount, delta));
}

function puff(ghost: Fighter, world: WorldState, events: SumoEvent[]): void {
  ghost.dashCooldown = PUFF_COOLDOWN;
  events.push({ type: 'puff', key: ghost.key, x: ghost.x, y: ghost.y, strength: 1 });
  for (const target of world.fighters) {
    if (target.status !== 'alive') continue;
    const dx = target.x - ghost.x;
    const dy = target.y - ghost.y;
    const distance = Math.hypot(dx, dy);
    if (distance > PUFF_RANGE + FIGHTER_RADIUS || distance < 1e-6) continue;
    const falloff = 1 - Math.min(1, distance / (PUFF_RANGE + FIGHTER_RADIUS)) * 0.5;
    target.vx += (dx / distance) * PUFF_KNOCKBACK * falloff;
    target.vy += (dy / distance) * PUFF_KNOCKBACK * falloff;
    target.stun = Math.max(target.stun, 0.2);
    target.lastHitBy = ghost.key;
    target.lastHitAt = world.time;
    target.impact = 0;
  }
}

function collide(a: Fighter, b: Fighter, time: number, events: SumoEvent[]): void {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let distance = Math.hypot(dx, dy);
  const minimum = FIGHTER_RADIUS * 2;
  if (distance >= minimum) return;
  if (distance < 1e-6) {
    dx = 1;
    dy = 0;
    distance = 1e-6;
  }
  const nx = dx / distance;
  const ny = dy / distance;
  const massA = a.dash > 0 ? DASH_MASS : 1;
  const massB = b.dash > 0 ? DASH_MASS : 1;
  const overlap = minimum - distance;
  const share = massB / (massA + massB);
  a.x -= nx * overlap * share;
  a.y -= ny * overlap * share;
  b.x += nx * overlap * (1 - share);
  b.y += ny * overlap * (1 - share);

  const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (approach <= 0) return;
  const aDashing = a.dash > 0 && a.vx * nx + a.vy * ny > 0;
  const bDashing = b.dash > 0 && -(b.vx * nx + b.vy * ny) > 0;
  const x = (a.x + b.x) / 2;
  const y = (a.y + b.y) / 2;

  if (aDashing && bDashing) {
    // Hai người cùng húc trực diện: cả hai bật ngược ra.
    const knock = DASH_KNOCKBACK * 0.75;
    a.vx = -nx * knock;
    a.vy = -ny * knock;
    b.vx = nx * knock;
    b.vy = ny * knock;
    for (const [fighter, other] of [[a, b], [b, a]] as const) {
      fighter.dash = 0;
      fighter.stun = HIT_STUN;
      fighter.lastHitBy = other.key;
      fighter.lastHitAt = time;
      fighter.impact = 0;
    }
    events.push({ type: 'clash', key: a.key, other: b.key, x, y, strength: 1 });
    return;
  }

  if (aDashing || bDashing) {
    const [attacker, target, sign] = aDashing ? [a, b, 1] : [b, a, -1];
    const speed = Math.hypot(attacker.vx, attacker.vy);
    const power = Math.max(0.55, Math.min(1.15, speed / DASH_SPEED));
    target.vx = nx * sign * DASH_KNOCKBACK * power + target.vx * 0.2;
    target.vy = ny * sign * DASH_KNOCKBACK * power + target.vy * 0.2;
    target.stun = HIT_STUN;
    target.lastHitBy = attacker.key;
    target.lastHitAt = time;
    target.impact = 0;
    target.dash = 0;
    attacker.vx *= 0.18;
    attacker.vy *= 0.18;
    attacker.dash = 0;
    attacker.impact = 0;
    events.push({ type: 'bump', key: attacker.key, other: target.key, x, y, strength: power });
    return;
  }

  // Va chạm thường: đàn hồi + nảy thêm cho vui.
  const impulse = ((1 + RESTITUTION) * approach) / 2 + BUMP_IMPULSE;
  a.vx -= nx * impulse;
  a.vy -= ny * impulse;
  b.vx += nx * impulse;
  b.vy += ny * impulse;
  a.impact = 0;
  b.impact = 0;
  // Người lao vào mạnh hơn được tính là người đẩy.
  const aSpeed = a.vx * nx + a.vy * ny;
  const bSpeed = -(b.vx * nx + b.vy * ny);
  const pusher = approach > 60 ? (aSpeed >= bSpeed ? a : b) : null;
  if (pusher) {
    const pushed = pusher === a ? b : a;
    pushed.lastHitBy = pusher.key;
    pushed.lastHitAt = time;
  }
  if (approach > 90) events.push({ type: 'bump', key: (pusher ?? a).key, other: (pusher === b ? a : b).key, x, y, strength: Math.min(0.6, approach / 500) });
}

function collideBumper(fighter: Fighter, bumper: Bumper, events: SumoEvent[]): void {
  const dx = fighter.x - bumper.x;
  const dy = fighter.y - bumper.y;
  const distance = Math.hypot(dx, dy);
  const minimum = FIGHTER_RADIUS + BUMPER_RADIUS;
  if (distance >= minimum || distance < 1e-6) return;
  const nx = dx / distance;
  const ny = dy / distance;
  fighter.x = bumper.x + nx * minimum;
  fighter.y = bumper.y + ny * minimum;
  const approach = -(fighter.vx * nx + fighter.vy * ny);
  if (approach <= 0) return;
  // Cột nảy bật mạnh hơn lúc lao vào: trúng là văng.
  const bounce = Math.max(320, approach * 1.5);
  fighter.vx += nx * (approach + bounce);
  fighter.vy += ny * (approach + bounce);
  fighter.stun = Math.max(fighter.stun, 0.3);
  fighter.dash = 0;
  fighter.impact = 0;
  events.push({ type: 'bumper', key: fighter.key, x: fighter.x - nx * FIGHTER_RADIUS, y: fighter.y - ny * FIGHTER_RADIUS, strength: Math.min(1, bounce / 600) });
}
