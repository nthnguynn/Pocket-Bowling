/** Đơn vị đường đua: làn rộng 100, trục y tăng theo hướng bi lăn tới đích. */
export const LANE_WIDTH = 100;
export const MARBLE_RADIUS = 4.5;
export const DEFAULT_COURSE_LENGTH = 3000;

/** Hình chữ nhật [x, x + w] × [y, y + h]. */
export interface Rect { x: number; y: number; w: number; h: number }

export type Obstacle =
  | ({ kind: 'block' } & Rect)
  /** Khối trượt ngang: tâm dao động quanh `center` với biên độ `range`. */
  | ({ kind: 'sweeper'; center: number; range: number; speed: number; phase: number } & Rect)
  /** Hố: rơi nếu lăn qua mà không nhảy. `safeX` là chỗ đặt lại bi sau khi rơi. */
  | ({ kind: 'hole'; safeX: number } & Rect)
  | ({ kind: 'boost' } & Rect)
  | { kind: 'gem'; id: number; x: number; y: number };

export interface Course {
  seed: number;
  length: number;
  /** Sắp theo y tăng dần để tra cứu theo đoạn. */
  obstacles: Obstacle[];
  gemCount: number;
}

/** PRNG nhỏ, xác định theo seed: mọi làn đua cùng một đường để công bằng. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function sweeperX(obstacle: Extract<Obstacle, { kind: 'sweeper' }>, time: number): number {
  return obstacle.center + Math.sin(time * obstacle.speed + obstacle.phase) * obstacle.range - obstacle.w / 2;
}

/**
 * Sinh đường đua: mỗi "hàng" chướng ngại cách nhau tối thiểu 80 đơn vị, luôn chừa khe
 * lăn qua được (trừ hố chắn ngang, bắt buộc nhảy). Càng về cuối càng khó.
 */
export function generateCourse(seed: number, length = DEFAULT_COURSE_LENGTH): Course {
  const rand = mulberry32(seed);
  const between = (min: number, max: number) => min + rand() * (max - min);
  const obstacles: Obstacle[] = [];
  let gemId = 0;
  const gem = (x: number, y: number) => obstacles.push({ kind: 'gem', id: gemId++, x, y });
  const W = LANE_WIDTH;

  let y = 170;
  while (y < length - 150) {
    const difficulty = y / length;
    const roll = rand();
    if (roll < 0.26) {
      // Hai khối chừa một khe; thỉnh thoảng một khối giữa đường chừa hai bên.
      if (rand() < 0.35) {
        const w = between(30, 46);
        const x = between(24, W - 24 - w);
        obstacles.push({ kind: 'block', x, y, w, h: 14 });
        gem(x < W / 2 - w / 2 ? x + w + (W - x - w) / 2 : x / 2, y + 7);
      } else {
        const gap = 36 - difficulty * 10;
        const center = between(gap / 2 + 6, W - gap / 2 - 6);
        if (center - gap / 2 > 3) obstacles.push({ kind: 'block', x: 0, y, w: center - gap / 2, h: 14 });
        if (W - center - gap / 2 > 3) obstacles.push({ kind: 'block', x: center + gap / 2, y, w: W - center - gap / 2, h: 14 });
        if (rand() < 0.5) gem(center, y + 7);
      }
    } else if (roll < 0.46) {
      const h = 24 + difficulty * 14;
      if (difficulty > 0.35 && rand() < 0.4) {
        // Hố chắn ngang cả làn: chỉ có cách nhảy.
        obstacles.push({ kind: 'hole', x: 0, y, w: W, h: 26, safeX: W / 2 });
      } else {
        const gap = 28 - difficulty * 6;
        const center = between(gap / 2 + 6, W - gap / 2 - 6);
        if (center - gap / 2 > 3) obstacles.push({ kind: 'hole', x: 0, y, w: center - gap / 2, h, safeX: center });
        if (W - center - gap / 2 > 3) obstacles.push({ kind: 'hole', x: center + gap / 2, y, w: W - center - gap / 2, h, safeX: center });
      }
    } else if (roll < 0.6) {
      const w = 28;
      obstacles.push({
        kind: 'sweeper', x: W / 2 - w / 2, y, w, h: 12,
        center: W / 2, range: (W - w) / 2 - 3, speed: between(1.1, 1.6 + difficulty * 1.2), phase: between(0, Math.PI * 2),
      });
    } else if (roll < 0.76) {
      // Chuỗi ngọc uốn lượn.
      const count = 4 + Math.floor(rand() * 3);
      const base = between(22, W - 22);
      const swing = between(8, 18);
      for (let index = 0; index < count; index += 1) {
        gem(Math.max(10, Math.min(W - 10, base + Math.sin(index * 0.9) * swing)), y + index * 13);
      }
    } else if (roll < 0.88) {
      const w = 26;
      const x = between(6, W - w - 6);
      obstacles.push({ kind: 'boost', x, y, w, h: 30 });
      gem(x + w / 2, y + 48);
    } else {
      // Hành lang hẹp.
      const width = 40 - difficulty * 8;
      const center = between(width / 2 + 10, W - width / 2 - 10);
      obstacles.push({ kind: 'block', x: 0, y, w: center - width / 2, h: 50 });
      obstacles.push({ kind: 'block', x: center + width / 2, y, w: W - center - width / 2, h: 50 });
      gem(center, y + 25);
    }
    y += 105 - difficulty * 25 + rand() * 40;
  }

  obstacles.sort((a, b) => a.y - b.y);
  return { seed, length, obstacles, gemCount: gemId };
}
