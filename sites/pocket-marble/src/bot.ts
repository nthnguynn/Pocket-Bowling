import { LANE_WIDTH, MARBLE_RADIUS, sweeperX, type Course } from './course';
import type { MarbleState } from './physics';

const LOOK_AHEAD = 58;

/** Xác suất bot "không thấy" một hàng hố, theo trình độ: bot giỏi nhất không bao giờ, bot 0,5 khoảng 1/5. */
const BLUNDER_PER_SKILL = 0.45;

/** Số giả ngẫu nhiên 0..1 cố định theo (hàng hố, bot): bot quyết định lỡ một hố thì lỡ từ đầu tới cuối, không lắc lư. */
function blunderRoll(y: number, salt: number): number {
  const value = Math.sin(y * 12.9898 + salt * 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

/**
 * `skill` 0..1: bot giỏi nhìn xa hơn và bẻ lái dứt khoát hơn; bot kém thỉnh thoảng lao thẳng vào hố.
 * Bot cho chế độ một người và cảnh chạy nền ở sảnh chờ: nhìn trước một đoạn,
 * nhắm vào khe trống gần nhất và nhảy khi phía trước là hố không né được.
 * `salt` phân biệt các bot với nhau để chúng không lỡ cùng một hố.
 */
export function botInput(marble: MarbleState, course: Course, time: number, skill = 1, salt = 0): { tilt: number; jump: boolean } {
  const blunder = (1 - Math.max(0, Math.min(1, skill))) * BLUNDER_PER_SKILL;
  const speed = Math.max(30, marble.vy);
  const lookAhead = LOOK_AHEAD * (0.5 + 0.5 * skill);
  const blocked: Array<[number, number]> = [];
  let nearestHole: { from: number; to: number; y: number } | null = null;
  for (const obstacle of course.obstacles) {
    if (obstacle.y > marble.y + lookAhead) break;
    if (obstacle.kind === 'gem' || obstacle.kind === 'boost' || obstacle.y + obstacle.h < marble.y) continue;
    const margin = MARBLE_RADIUS + 2.5;
    if (obstacle.kind === 'hole') {
      if (blunderRoll(obstacle.y, salt) < blunder) continue;
      blocked.push([obstacle.x - margin * 0.4, obstacle.x + obstacle.w + margin * 0.4]);
      if (marble.x > obstacle.x - 1 && marble.x < obstacle.x + obstacle.w + 1 && (!nearestHole || obstacle.y < nearestHole.y)) {
        nearestHole = { from: obstacle.x, to: obstacle.x + obstacle.w, y: obstacle.y };
      }
    } else {
      // Đoán vị trí khối trượt lúc bi tới nơi.
      const x = obstacle.kind === 'sweeper' ? sweeperX(obstacle, time + (obstacle.y - marble.y) / speed) : obstacle.x;
      blocked.push([x - margin, x + obstacle.w + margin]);
    }
  }

  const gaps: Array<[number, number]> = [];
  let cursor = MARBLE_RADIUS;
  for (const [from, to] of blocked.sort((a, b) => a[0] - b[0])) {
    if (from > cursor + 2) gaps.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < LANE_WIDTH - MARBLE_RADIUS - 2) gaps.push([cursor, LANE_WIDTH - MARBLE_RADIUS]);

  let target = marble.x;
  if (gaps.length) {
    const distance = ([from, to]: [number, number]) => (marble.x < from ? from - marble.x : marble.x > to ? marble.x - to : 0);
    const best = gaps.reduce((a, b) => (distance(b) < distance(a) ? b : a));
    target = Math.max(best[0] + 3, Math.min(best[1] - 3, marble.x < best[0] || marble.x > best[1] ? (best[0] + best[1]) / 2 : marble.x));
  }
  const tilt = Math.max(-1, Math.min(1, ((target - marble.x) / 12 - marble.vx * 0.03) * (0.45 + 0.55 * skill)));
  const holeDistance = nearestHole ? nearestHole.y - marble.y : Infinity;
  const jump = holeDistance > 4 && holeDistance < 4 + speed * 0.16 && (gaps.length === 0 || Math.abs(target - marble.x) > 6);
  return { tilt, jump };
}
