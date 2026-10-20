import { LANE_WIDTH, MARBLE_RADIUS, sweeperX, type Course, type Rect } from './course';

export const CRUISE_SPEED = 95;
export const BOOST_SPEED = 150;
export const STUN_SPEED = 42;
const ACCELERATION = 60;
const STEER = 270;
const LATERAL_DRAG = 2.6;
const GRAVITY = 520;
const JUMP_VELOCITY = 165;
const FALL_SECONDS = 0.8;

export type MarbleStatus = 'ready' | 'rolling' | 'falling' | 'finished';
export type MarbleEvent = 'gem' | 'bump' | 'fall' | 'respawn' | 'jump' | 'boost' | 'finish' | 'drop';

export interface MarbleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Độ cao khi nhảy; 0 là đang lăn trên mặt đường. */
  z: number;
  vz: number;
  status: MarbleStatus;
  fallTimer: number;
  respawnX: number;
  respawnY: number;
  /** Giây còn lại bị choáng (va đầu vào khối hoặc làm rơi bi khỏi khay). */
  stun: number;
  boost: number;
  jumpCooldown: number;
  collected: Set<number>;
  finishTime: number | null;
  /** Góc lăn để vẽ, tích lũy theo quãng đường. */
  roll: number;
}

/**
 * Khay trên điện thoại: thay cho việc giữ cuộn giấy thật khỏi lăn khỏi tấm bìa.
 * Nghiêng nhẹ thì bi nằm yên; giữ nghiêng hết cỡ khoảng 2 giây thì bi lăn ra mép và rơi.
 */
export interface TrayState { position: number; velocity: number }

export function stepTray(tray: TrayState, tilt: number, dt: number): boolean {
  tray.velocity += (tilt * 1.2 - tray.position * 0.7) * dt;
  tray.velocity -= tray.velocity * 2 * dt;
  tray.position += tray.velocity * dt;
  if (Math.abs(tray.position) < 1) return false;
  tray.position = 0;
  tray.velocity = 0;
  return true;
}

export function createMarble(x = LANE_WIDTH / 2): MarbleState {
  return {
    x, y: 0, vx: 0, vy: 0, z: 0, vz: 0, status: 'ready', fallTimer: 0, respawnX: x, respawnY: 0,
    stun: 0, boost: 0, jumpCooldown: 0, collected: new Set(), finishTime: null, roll: 0,
  };
}

/** Chỉ số obstacle đầu tiên có y >= minY (obstacles đã sắp theo y). */
function firstIndexFrom(course: Course, minY: number): number {
  let low = 0;
  let high = course.obstacles.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (course.obstacles[mid]!.y < minY) low = mid + 1;
    else high = mid;
  }
  return low;
}

function inside(rect: Rect, x: number, y: number, inset = 0): boolean {
  return x > rect.x + inset && x < rect.x + rect.w - inset && y > rect.y + inset && y < rect.y + rect.h - inset;
}

/** Đẩy bi ra khỏi khối đặc; trả về true nếu là cú va trực diện (mặt trước khối). */
function collideSolid(marble: MarbleState, rect: Rect): 'front' | 'side' | null {
  const nearestX = Math.max(rect.x, Math.min(marble.x, rect.x + rect.w));
  const nearestY = Math.max(rect.y, Math.min(marble.y, rect.y + rect.h));
  const dx = marble.x - nearestX;
  const dy = marble.y - nearestY;
  const distance = Math.hypot(dx, dy);
  if (distance >= MARBLE_RADIUS) return null;
  if (distance < 1e-6) {
    // Tâm đã lọt vào trong khối: đẩy ra mặt gần nhất.
    const left = marble.x - rect.x;
    const right = rect.x + rect.w - marble.x;
    const front = marble.y - rect.y;
    const back = rect.y + rect.h - marble.y;
    const min = Math.min(left, right, front, back);
    if (min === front) marble.y = rect.y - MARBLE_RADIUS;
    else if (min === back) marble.y = rect.y + rect.h + MARBLE_RADIUS;
    else if (min === left) marble.x = rect.x - MARBLE_RADIUS;
    else marble.x = rect.x + rect.w + MARBLE_RADIUS;
    return min === front ? 'front' : 'side';
  }
  const push = MARBLE_RADIUS - distance;
  marble.x += (dx / distance) * push;
  marble.y += (dy / distance) * push;
  return Math.abs(dy) > Math.abs(dx) && dy < 0 ? 'front' : 'side';
}

/**
 * Một bước vật lý cố định cho một viên bi trong làn của nó.
 * `time` là đồng hồ cuộc đua (để khối trượt giống nhau ở mọi làn).
 */
export function stepMarble(
  marble: MarbleState,
  input: { tilt: number; jump: boolean },
  course: Course,
  time: number,
  dt: number,
  events: MarbleEvent[],
): void {
  if (marble.status === 'ready') return;
  if (marble.status === 'finished') {
    marble.vy = Math.max(0, marble.vy - 80 * dt);
    marble.vx -= marble.vx * 3 * dt;
    marble.x = Math.max(MARBLE_RADIUS, Math.min(LANE_WIDTH - MARBLE_RADIUS, marble.x + marble.vx * dt));
    marble.y += marble.vy * dt;
    marble.roll += (marble.vy * dt) / MARBLE_RADIUS;
    return;
  }
  if (marble.status === 'falling') {
    marble.fallTimer -= dt;
    if (marble.fallTimer <= 0) {
      Object.assign(marble, { status: 'rolling', x: marble.respawnX, y: marble.respawnY, vx: 0, vy: 25, z: 0, vz: 0, boost: 0 });
      events.push('respawn');
    }
    return;
  }

  marble.stun = Math.max(0, marble.stun - dt);
  marble.boost = Math.max(0, marble.boost - dt);
  marble.jumpCooldown = Math.max(0, marble.jumpCooldown - dt);

  const target = marble.stun > 0 ? STUN_SPEED : marble.boost > 0 ? BOOST_SPEED : CRUISE_SPEED;
  marble.vy += marble.vy < target
    ? Math.min(target - marble.vy, ACCELERATION * dt)
    : Math.max(target - marble.vy, -ACCELERATION * 2 * dt);
  const control = marble.stun > 0 ? 0.3 : 1;
  marble.vx += Math.max(-1, Math.min(1, input.tilt)) * STEER * control * dt;
  marble.vx -= marble.vx * LATERAL_DRAG * dt;

  if (input.jump && marble.z === 0 && marble.jumpCooldown === 0) {
    marble.vz = JUMP_VELOCITY;
    marble.jumpCooldown = 0.45;
    events.push('jump');
  }
  if (marble.z > 0 || marble.vz > 0) {
    marble.z += marble.vz * dt;
    marble.vz -= GRAVITY * dt;
    if (marble.z <= 0) {
      marble.z = 0;
      marble.vz = 0;
    }
  }

  marble.x += marble.vx * dt;
  marble.y += marble.vy * dt;
  marble.roll += (marble.vy * dt) / MARBLE_RADIUS;
  if (marble.x < MARBLE_RADIUS) {
    marble.x = MARBLE_RADIUS;
    marble.vx = Math.abs(marble.vx) * 0.35;
  } else if (marble.x > LANE_WIDTH - MARBLE_RADIUS) {
    marble.x = LANE_WIDTH - MARBLE_RADIUS;
    marble.vx = -Math.abs(marble.vx) * 0.35;
  }

  const obstacles = course.obstacles;
  for (let index = firstIndexFrom(course, marble.y - 60); index < obstacles.length; index += 1) {
    const obstacle = obstacles[index]!;
    if (obstacle.y > marble.y + MARBLE_RADIUS + 1) break;
    if (obstacle.kind === 'gem') {
      if (!marble.collected.has(obstacle.id) && marble.z < 8
        && Math.hypot(marble.x - obstacle.x, marble.y - obstacle.y) < MARBLE_RADIUS + 4) {
        marble.collected.add(obstacle.id);
        events.push('gem');
      }
      continue;
    }
    if (obstacle.kind === 'block' || obstacle.kind === 'sweeper') {
      const rect = obstacle.kind === 'sweeper' ? { ...obstacle, x: sweeperX(obstacle, time) } : obstacle;
      const hit = collideSolid(marble, rect);
      if (hit === 'front') {
        if (marble.vy > 40) events.push('bump');
        marble.vy = -Math.max(15, marble.vy * 0.3);
        marble.stun = Math.max(marble.stun, 0.35);
      } else if (hit === 'side') {
        marble.vx = -marble.vx * 0.5 + (marble.x < rect.x + rect.w / 2 ? -18 : 18);
      }
      continue;
    }
    if (marble.z > 0) continue;
    if (obstacle.kind === 'hole' && inside(obstacle, marble.x, marble.y, MARBLE_RADIUS * 0.4)) {
      marble.status = 'falling';
      marble.fallTimer = FALL_SECONDS;
      marble.respawnX = obstacle.safeX;
      marble.respawnY = obstacle.y - 18;
      marble.vx = 0;
      events.push('fall');
      return;
    }
    if (obstacle.kind === 'boost' && inside(obstacle, marble.x, marble.y)) {
      if (marble.boost < 0.9) events.push('boost');
      marble.boost = 1.2;
    }
  }

  if (marble.y >= course.length) {
    marble.status = 'finished';
    marble.finishTime = time;
    events.push('finish');
  }
}
