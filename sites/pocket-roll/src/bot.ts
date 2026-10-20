import { moverProgress, ROLL_RADIUS, sawPosition, type Level, type RollState, type RouteStep } from './physics';

/**
 * Bot bám theo `level.route`: lăn tới từng mốc, nhảy ở mốc có `jump`, đứng yên `wait` giây,
 * chờ bục tới rồi bước lên (`board`) hoặc đứng yên cho bục chở đi (`ride`).
 */
export interface BotMemory { index: number; waitUntil: number; hold: RouteStep | null; lastDeaths: number; lastCheckpoint: number }

export function createBotMemory(): BotMemory {
  return { index: 0, waitUntil: 0, hold: null, lastDeaths: 0, lastCheckpoint: -1 };
}

/** Còn phải đứng chờ ở mốc `step` không. */
function holding(step: RouteStep, level: Level, time: number): boolean {
  if (step.board !== undefined) {
    const mover = level.movers?.[step.board];
    return Boolean(mover) && moverProgress(mover!, time) > 0.04;
  }
  if (step.ride) {
    const mover = level.movers?.[step.ride.mover];
    return Boolean(mover) && moverProgress(mover!, time) < step.ride.until;
  }
  return false;
}

const REACH_X = 26;
const REACH_Y = 110;
const MAX_SPEED = 380;
/** Tốc độ bot ước lượng khi tính xem có kịp lăn qua dưới lưỡi cưa không. */
const CROSS_SPEED = 320;

/** Lưỡi cưa chạy ở phía trước có cắt ngang đường lăn trong ~1 giây tới không (cưa đứng yên thì route đã tính nhảy qua). */
function sawThreat(roll: RollState, level: Level, time: number, direction: number): boolean {
  for (const saw of level.saws ?? []) {
    if (!saw.move && !saw.orbit) continue;
    const [sx] = sawPosition(saw, time);
    const ahead = (sx - roll.x) * direction;
    if (ahead < 0 || ahead > saw.r + ROLL_RADIUS + 180) continue;
    for (let tau = 0; tau <= 1.2; tau += 0.04) {
      const [px, py] = sawPosition(saw, time + tau);
      const x = roll.x + direction * CROSS_SPEED * tau;
      if (Math.hypot(x - px, roll.y - py) < saw.r + ROLL_RADIUS * 0.7 + 12) return true;
    }
  }
  return false;
}

export function botInput(roll: RollState, level: Level, memory: BotMemory, time: number): { tilt: number; jump: boolean } {
  if (roll.checkpoint !== memory.lastCheckpoint) {
    memory.lastCheckpoint = roll.checkpoint;
    const checkpoint = level.checkpoints?.[roll.checkpoint];
    if (checkpoint) memory.index = Math.max(memory.index, checkpoint.route);
  }
  if (roll.deaths !== memory.lastDeaths) {
    // Chết thì làm lại từ cờ gần nhất (hoặc từ đầu).
    memory.lastDeaths = roll.deaths;
    memory.index = level.checkpoints?.[roll.checkpoint]?.route ?? 0;
    memory.waitUntil = 0;
    memory.hold = null;
  }
  if (roll.status !== 'rolling') return { tilt: 0, jump: false };

  // Đang chờ trên bục: chỉ hãm cho đứng yên so với bục để nó chở đi.
  if (memory.hold?.ride && holding(memory.hold, level, time)) return { tilt: Math.max(-1, Math.min(1, -roll.vx / 160)), jump: false };
  // Chờ trên nền: giữ đúng chỗ của mốc (đứng sát mép bo tròn thì sẽ tự trôi ra).
  const anchor = level.route[memory.index - 1];
  const stay = () => ({ tilt: Math.max(-1, Math.min(1, ((anchor?.x ?? roll.x) - roll.x) * 0.02 - roll.vx / 120)), jump: false });
  if (memory.hold && holding(memory.hold, level, time)) return stay();
  memory.hold = null;
  if (time < memory.waitUntil) return stay();

  const goal = level.goal;
  const target = level.route[memory.index] ?? { x: goal.x + goal.w / 2 };
  const dx = target.x - roll.x;
  const reached = Math.abs(dx) < REACH_X && (target.y === undefined || Math.abs(target.y - roll.y) < REACH_Y);
  let jump = false;
  if (reached && memory.index < level.route.length) {
    if (target.jump && !roll.grounded) return { tilt: Math.sign(dx || roll.vx) * 0.6, jump: false };
    jump = Boolean(target.jump);
    if (target.wait) memory.waitUntil = time + target.wait;
    if (target.board !== undefined || target.ride) memory.hold = target;
    memory.index += 1;
  }

  const next = level.route[memory.index] ?? { x: goal.x + goal.w / 2 };
  const after = level.route[memory.index + 1] ?? { x: goal.x + goal.w / 2 };
  // Mốc chỉ đi ngang qua (cùng hướng với mốc sau, không phải chờ) thì giữ nguyên đà, nhất là trước cú nhảy.
  const toward = next.x - roll.x;
  // Mốc cuối thì đích ở ngay đó: cứ đi tiếp hết tốc.
  const last = memory.index === level.route.length - 1;
  const passing = !next.wait && !next.board && !next.ride && memory.index < level.route.length
    && (last || Math.sign(after.x - next.x) === Math.sign(toward));
  // Cưa sắp cắt ngang đường: dừng lại chờ nó qua.
  if (roll.grounded && !jump && sawThreat(roll, level, time, Math.sign(toward))) {
    return { tilt: Math.max(-1, Math.min(1, -roll.vx / 120)), jump: false };
  }
  if (passing) return { tilt: Math.sign(toward), jump };
  const desired = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, toward * 2.4));
  const tilt = Math.max(-1, Math.min(1, (desired - roll.vx) / 220));
  return { tilt, jump };
}
