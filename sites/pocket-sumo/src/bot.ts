import { DASH_SPEED, FIGHTER_RADIUS, PUFF_RANGE, type Fighter, type WorldState } from './physics';

/** Quãng đường xấp xỉ một cú húc đi được (dùng để bot không tự lao ra khỏi sàn). */
const DASH_REACH = 170;

export interface BotDecision { x: number; y: number; dash: boolean }

/**
 * `skill` 0..1: bot giỏi giữ khoảng cách với mép, canh hướng húc chuẩn và né cú húc.
 * Bot kém lao bừa, hay tự rơi — đủ làm bao cát cho người mới. `random` để test có thể cố định.
 */
export function botDecision(bot: Fighter, world: WorldState, random: () => number = Math.random): BotDecision {
  const skill = Math.max(0, Math.min(1, bot.botSkill));
  if (bot.status === 'ghost') return ghostDecision(bot, world, random);

  const targets = world.fighters.filter((other) => other !== bot && other.status === 'alive');
  const fromCenter = Math.hypot(bot.x, bot.y);
  const safeRadius = world.radius - FIGHTER_RADIUS * (1.6 + skill * 1.4);
  let x = 0;
  let y = 0;

  const target = targets.reduce<Fighter | null>((best, other) => {
    if (!best) return other;
    return distanceBetween(bot, other) < distanceBetween(bot, best) ? other : best;
  }, null);

  if (target) {
    // Đứng vào phía "trong" của mục tiêu rồi mới đẩy ra mép.
    const outward = Math.hypot(target.x, target.y) || 1;
    const approachX = target.x - (target.x / outward) * FIGHTER_RADIUS * 2.2 * skill;
    const approachY = target.y - (target.y / outward) * FIGHTER_RADIUS * 2.2 * skill;
    x = approachX - bot.x;
    y = approachY - bot.y;
    // Đã vào thế thì quay mặt về mục tiêu để canh húc.
    if (Math.hypot(x, y) < FIGHTER_RADIUS * 1.5) {
      x = target.x - bot.x;
      y = target.y - bot.y;
    }
  }

  // Né cú húc đang lao tới.
  for (const other of targets) {
    if (other.dash <= 0 || random() > skill) continue;
    const toBotX = bot.x - other.x;
    const toBotY = bot.y - other.y;
    const distance = Math.hypot(toBotX, toBotY);
    const speed = Math.hypot(other.vx, other.vy) || 1;
    if (distance < 200 && (other.vx * toBotX + other.vy * toBotY) / (distance * speed) > 0.8) {
      x = -other.vy;
      y = other.vx;
      if (x * bot.x + y * bot.y > 0) {
        x = -x;
        y = -y;
      }
    }
  }

  // Sát mép thì ưu tiên quay vào giữa.
  if (fromCenter > safeRadius) {
    const urgency = Math.min(1, (fromCenter - safeRadius) / 40) * (0.4 + skill * 0.6);
    const length = Math.hypot(x, y) || 1;
    x = (x / length) * (1 - urgency) - (bot.x / fromCenter) * urgency * 1.5;
    y = (y / length) * (1 - urgency) - (bot.y / fromCenter) * urgency * 1.5;
  }

  const length = Math.hypot(x, y);
  const pace = 0.55 + skill * 0.45;
  const move = length > 1e-6 ? { x: (x / length) * pace, y: (y / length) * pace } : { x: 0, y: 0 };

  let dash = false;
  if (target && bot.dashCooldown === 0 && bot.stun === 0) {
    const distance = distanceBetween(bot, target);
    const aimX = (target.x - bot.x) / (distance || 1);
    const aimY = (target.y - bot.y) / (distance || 1);
    const facingX = Math.cos(bot.facing);
    const facingY = Math.sin(bot.facing);
    const aligned = aimX * facingX + aimY * facingY > 0.9 - (1 - skill) * 0.4;
    const landingX = bot.x + aimX * DASH_REACH;
    const landingY = bot.y + aimY * DASH_REACH;
    // Bot giỏi chỉ húc khi điểm dừng còn trên sàn (hoặc có người đỡ).
    const safe = Math.hypot(landingX, landingY) < world.radius - 10 || distance < FIGHTER_RADIUS * 3 || random() > 0.4 + skill * 0.6;
    const eager = random() < 0.04 + skill * 0.08;
    dash = distance < DASH_REACH * 0.85 && aligned && safe && eager;
  }
  if (dash && target) {
    const lead = (distanceBetween(bot, target) / DASH_SPEED) * skill;
    return { ...direction(target.x + target.vx * lead - bot.x, target.y + target.vy * lead - bot.y), dash };
  }
  return { ...move, dash };
}

function ghostDecision(ghost: Fighter, world: WorldState, random: () => number): BotDecision {
  const alive = world.fighters.filter((other) => other.status === 'alive');
  if (!alive.length) return { x: 0, y: 0, dash: false };
  // Hồn ma bay ra phía ngoài người còn sống để thổi họ về phía mép.
  const target = alive.reduce((best, other) => (distanceBetween(ghost, other) < distanceBetween(ghost, best) ? other : best));
  const outward = Math.hypot(target.x, target.y) || 1;
  const spotX = target.x - (target.x / outward) * PUFF_RANGE * 0.6;
  const spotY = target.y - (target.y / outward) * PUFF_RANGE * 0.6;
  const move = direction(spotX - ghost.x, spotY - ghost.y);
  const close = distanceBetween(ghost, target) < PUFF_RANGE;
  return { x: move.x * 0.8, y: move.y * 0.8, dash: close && ghost.dashCooldown === 0 && random() < 0.05 * ghost.botSkill };
}

function distanceBetween(a: Fighter, b: Fighter): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function direction(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y);
  return length > 1e-6 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}
