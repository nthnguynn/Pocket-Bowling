import { initials, type ThemeMode } from '@pocket/party-kit';
import {
  moverOffset, ROLL_RADIUS, sawPosition, seesawEnds, WORLD_HEIGHT, WORLD_WIDTH, type Point, type RollEvent, type WorldState,
} from './physics';
import type { MatchEvent, Roller, RollMatch } from './RollMatch';

interface Palette {
  backdrop: string;
  wall: string;
  wallLine: string;
  /** Đường ray mờ của bục và cưa di chuyển. */
  track: string;
  platform: string;
  platformTop: string;
  shadow: string;
  bouncy: string;
  mover: string;
  saw: string;
  sawTooth: string;
  water: string;
  waterTop: string;
  fan: string;
  door: string;
  doorFrame: string;
  text: string;
  textSoft: string;
  /** Nền nhãn người chơi trên khung chia màn hình. */
  hud: string;
  paper: string;
  core: string;
}

const LIGHT: Palette = {
  backdrop: '#f4ddea', wall: '#efe8de', wallLine: 'rgba(120,96,70,0.08)', track: 'rgba(120,96,70,0.3)', platform: '#7d7a80', platformTop: '#a9a6ad',
  shadow: 'rgba(60,40,30,0.16)', bouncy: '#3cc47c', mover: '#e8a33a', saw: '#b9c2cc', sawTooth: '#e8414f',
  water: 'rgba(70,160,230,0.55)', waterTop: '#9fd6ff', fan: '#8aa0b4', door: '#7fb8e8', doorFrame: '#4c7fae',
  text: '#2d1426', textSoft: '#74586a', hud: 'rgba(255,249,252,0.92)', paper: '#ffffff', core: '#c9a27a',
};

const DARK: Palette = {
  backdrop: '#130814', wall: '#2a1f2e', wallLine: 'rgba(255,220,240,0.05)', track: 'rgba(255,220,240,0.2)', platform: '#8c8597', platformTop: '#b9b2c4',
  shadow: 'rgba(0,0,0,0.35)', bouncy: '#58e39a', mover: '#ffb84c', saw: '#c9d1da', sawTooth: '#ff5a64',
  water: 'rgba(76,170,255,0.5)', waterTop: '#8fd0ff', fan: '#9fb2c6', door: '#5d8fc4', doorFrame: '#a7cdf0',
  text: '#fff4fb', textSoft: '#c9a9bf', hud: 'rgba(19,8,20,0.82)', paper: '#fbf8f2', core: '#c9a27a',
};

const TOP_MARGIN = 92;
const BOTTOM_MARGIN = 104;
const FONT = '"Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
/** Chia đôi màn hình: mỗi nửa thấy khoảng ngần này đơn vị bề ngang của màn chơi (cả màn rộng WORLD_WIDTH). */
const FOLLOW_WIDTH = 900;
const SPLIT_GAP = 14;
/** Khi chia màn hình, dải người chơi dưới đáy được ẩn (mỗi khung đã có nhãn riêng) nên khung cao hơn. */
const SPLIT_BOTTOM_MARGIN = 58;

/** `owner` là key người chơi gây ra hiệu ứng: ở chế độ mỗi người một sân, khung của ai chỉ thấy hiệu ứng của người đó. */
interface Floater { x: number; y: number; text: string; color: string; born: number; owner: string | null }
interface Camera { x: number; y: number }
interface Particle { x: number; y: number; vx: number; vy: number; spin: number; born: number; life: number; color: string; size: number; gravity: number; owner: string | null }

/**
 * shared: một khung chung cho mọi người. split: mỗi người một khung bám theo mình, vẫn thấy người khác.
 * solo: mỗi người một khung chỉ có mình mình (sân riêng, xem RollMatch.setSeparate).
 */
export type RollViewMode = 'shared' | 'split' | 'solo';

export class RollRenderer {
  readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private palette = DARK;
  private width = 1;
  private height = 1;
  private scale = 1;
  private originX = 0;
  private originY = 0;
  private shake = 0;
  private floaters: Floater[] = [];
  private particles: Particle[] = [];
  /** Phần bên trái bị sảnh chờ che; màn được căn giữa phần còn lại. */
  private inset = 0;
  /** Camera của từng người khi chia màn hình, theo key người chơi. */
  private cameras = new Map<string, Camera>();
  private viewMode: RollViewMode = 'shared';

  constructor(private readonly container: HTMLElement) {
    this.canvas.className = 'roll-canvas';
    container.append(this.canvas);
    this.context = this.canvas.getContext('2d')!;
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  setTheme(theme: ThemeMode): void {
    this.palette = theme === 'light' ? LIGHT : DARK;
  }

  setViewMode(mode: RollViewMode): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.cameras.clear();
  }

  setInset(left: number): void {
    if (left === this.inset) return;
    this.inset = left;
    this.resize();
  }

  reset(): void {
    this.floaters = [];
    this.particles = [];
    this.shake = 0;
    this.cameras.clear();
  }

  effect(match: RollMatch, entry: MatchEvent, now: number): void {
    if (entry.roller < 0) return;
    const roller = match.rollers[entry.roller];
    if (!roller) return;
    const { x, y } = roller.roll;
    const event = entry.event as RollEvent;
    if (event.type === 'die') {
      if (event.cause === 'saw') {
        // Giấy rách vụn bay tứ tung.
        this.burst(x, y, 34, [this.palette.paper, '#f1ece4', roller.color], 420, now, 900, roller.key);
        this.floater(x, y - 30, 'XOẸT!', this.palette.sawTooth, now, roller.key);
        this.shake = Math.max(this.shake, 0.3);
      } else if (event.cause === 'water') {
        this.burst(x, y, 18, [this.palette.waterTop, '#ffffff'], 300, now, 700, roller.key);
        this.floater(x, y - 30, 'ƯỚT SŨNG!', this.palette.waterTop, now, roller.key);
      } else {
        this.floater(x, Math.min(WORLD_HEIGHT - 40, y), 'Á Á!', roller.color, now, roller.key);
      }
    } else if (event.type === 'goal') {
      this.burst(x, y, 40, [roller.color, '#ffc23d', '#ffffff', '#7fe7ff'], 360, now, 1_300, roller.key);
      this.floater(x, y - 50, 'GIAO XONG!', roller.color, now, roller.key);
    } else if (event.type === 'checkpoint') {
      this.floater(x, y - 40, 'ĐÃ LƯU!', '#58e39a', now, roller.key);
    } else if (event.type === 'bounce') {
      this.burst(x, y + ROLL_RADIUS, 8, [this.palette.bouncy], 160, now, 400, roller.key);
    } else if (event.type === 'land' && event.strength > 0.5) {
      this.burst(x, y + ROLL_RADIUS, 6, [this.palette.platformTop], 120, now, 380, roller.key);
    } else if (event.type === 'respawn') {
      this.burst(x, y, 10, [roller.color], 120, now, 420, roller.key);
    }
  }

  render(match: RollMatch, now: number, elapsed: number): void {
    const ctx = this.context;
    const p = this.palette;
    this.shake = Math.max(0, this.shake - elapsed);
    this.floaters = this.floaters.filter((floater) => now - floater.born < 1_100);
    this.particles = this.particles.filter((particle) => now - particle.born < particle.life);
    ctx.fillStyle = p.backdrop;
    ctx.fillRect(0, 0, this.width, this.height);

    // Chia màn hình khi đã vào trận (sảnh chờ đóng) và có từ hai người chơi thật.
    const viewers = this.viewMode !== 'shared' && this.inset === 0 ? match.rollers.filter((roller) => !roller.bot) : [];
    if (viewers.length >= 2) {
      this.renderSplit(match, viewers, this.viewMode === 'solo', now, elapsed);
      return;
    }
    ctx.save();
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * this.shake * 16, (Math.random() - 0.5) * this.shake * 16);
    ctx.translate(this.originX, this.originY);
    ctx.scale(this.scale, this.scale);
    this.drawScene(match, now, match.world, match.rollers, null, null);
    ctx.restore();
  }

  /** Mỗi người một khung: 2 người 2 cột, 3–4 người lưới 2×2, 5–6 người 3×2, 7–8 người 4×2. */
  private renderSplit(match: RollMatch, viewers: Roller[], solo: boolean, now: number, elapsed: number): void {
    const ctx = this.context;
    const count = viewers.length;
    const columns = count <= 2 ? count : count <= 4 ? 2 : count <= 6 ? 3 : 4;
    const rows = Math.ceil(count / columns);
    const areaHeight = Math.max(200, this.height - TOP_MARGIN - SPLIT_BOTTOM_MARGIN);
    const width = Math.max(160, (this.width - 40 - SPLIT_GAP * (columns - 1)) / columns);
    const height = Math.max(120, (areaHeight - SPLIT_GAP * (rows - 1)) / rows);
    // Luôn thấy khoảng FOLLOW_WIDTH bề ngang; khung quá thấp thì thu nhỏ để vẫn thấy đủ trên dưới.
    const scale = Math.max(width / WORLD_WIDTH, Math.min(width / FOLLOW_WIDTH, height / 640));
    const visibleW = width / scale;
    const visibleH = height / scale;
    const center = (value: number, visible: number, world: number) =>
      (visible >= world ? world / 2 : Math.max(visible / 2, Math.min(world - visible / 2, value)));

    viewers.forEach((roller, index) => {
      const left = 20 + (index % columns) * (width + SPLIT_GAP);
      const top = TOP_MARGIN + Math.floor(index / columns) * (height + SPLIT_GAP);
      const target = { x: center(roller.roll.x, visibleW, WORLD_WIDTH), y: center(roller.roll.y, visibleH, WORLD_HEIGHT) };
      const previous = this.cameras.get(roller.key);
      // Bám mượt; sống lại ở cờ xa thì nhảy thẳng tới.
      const camera = !previous || Math.hypot(previous.x - target.x, previous.y - target.y) > 500
        ? target
        : { x: previous.x + (target.x - previous.x) * Math.min(1, elapsed * 6), y: previous.y + (target.y - previous.y) * Math.min(1, elapsed * 6) };
      this.cameras.set(roller.key, camera);

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(left, top, width, height, 22);
      ctx.clip();
      if (this.shake > 0) ctx.translate((Math.random() - 0.5) * this.shake * 12, (Math.random() - 0.5) * this.shake * 12);
      ctx.translate(left + width / 2, top + height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-camera.x, -camera.y);
      // Khung của ai thì không cần thẻ tên trên cuộn giấy của người đó: nhãn khung đã ghi rồi.
      if (solo) this.drawScene(match, now, match.worldFor(roller), [roller], roller.key, roller.key);
      else this.drawScene(match, now, match.world, match.rollers, null, roller.key);
      ctx.restore();

      if (!solo) {
        viewers.forEach((other) => {
          if (other !== roller) this.drawOffscreenArrow(other, camera, scale, left, top, width, height);
        });
      }
      this.drawViewFrame(roller, left, top, width, height);
    });
  }

  /** Người kia ra khỏi khung hình của mình: mũi tên màu của họ ở mép, chỉ về phía họ. */
  private drawOffscreenArrow(other: Roller, camera: Camera, scale: number, left: number, top: number, width: number, height: number): void {
    const roll = other.roll;
    if (roll.status === 'dead' || roll.status === 'done') return;
    const sx = left + width / 2 + (roll.x - camera.x) * scale;
    const sy = top + height / 2 + (roll.y - camera.y) * scale;
    const margin = 26;
    if (sx > left + margin && sx < left + width - margin && sy > top + margin && sy < top + height - margin) return;
    const x = Math.max(left + margin, Math.min(left + width - margin, sx));
    const y = Math.max(top + margin, Math.min(top + height - margin, sy));
    const angle = Math.atan2(sy - y, sx - x);
    const ctx = this.context;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = other.color;
    ctx.strokeStyle = 'rgba(20,4,16,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-10, -12);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-10, 12);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  /** Viền màu người chơi và một nhãn duy nhất: chữ cái đầu, tên, điểm và số lần chết (hoặc trạng thái). */
  private drawViewFrame(roller: Roller, left: number, top: number, width: number, height: number): void {
    const ctx = this.context;
    const p = this.palette;
    const roll = roller.roll;
    ctx.strokeStyle = roller.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(left + 1.5, top + 1.5, width - 3, height - 3, 21);
    ctx.stroke();

    const status = roll.status === 'done' ? 'ĐÃ GIAO GIẤY' : roll.status === 'dead' ? 'RÁCH GIẤY!' : `${roller.points} điểm · chết ${roll.deaths}`;
    ctx.font = `800 18px ${FONT}`;
    const nameWidth = ctx.measureText(roller.name).width;
    ctx.font = `600 12px ${FONT}`;
    const statusWidth = ctx.measureText(status).width;
    const x = left + 12;
    const y = top + 12;
    const pillWidth = Math.min(width - 24, 66 + Math.max(nameWidth, statusWidth));
    ctx.fillStyle = p.hud;
    ctx.beginPath();
    ctx.roundRect(x, y, pillWidth, 48, 24);
    ctx.fill();
    ctx.strokeStyle = roller.color;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = roller.color;
    ctx.beginPath();
    ctx.arc(x + 24, y + 24, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0a14';
    ctx.font = `800 16px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials(roller.name), x + 24, y + 25);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 48, y, pillWidth - 60, 48);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.fillStyle = p.text;
    ctx.font = `800 18px ${FONT}`;
    ctx.fillText(roller.name, x + 50, y + 18);
    ctx.fillStyle = roll.status === 'done' ? '#58e39a' : roll.status === 'dead' ? p.sawTooth : p.textSoft;
    ctx.font = `600 12px ${FONT}`;
    ctx.fillText(status, x + 50, y + 35);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * Vẽ màn chơi trong hệ tọa độ thế giới (đã đặt sẵn phép biến đổi camera). `world` là sân để vẽ
   * (bập bênh, đồng hồ), `visible` là những cuộn giấy được thấy, `owner` lọc hiệu ứng khi mỗi người một sân,
   * `self` là chủ khung (không vẽ thẻ tên của họ).
   */
  private drawScene(match: RollMatch, now: number, world: WorldState, visible: Roller[], owner: string | null, self: string | null): void {
    const ctx = this.context;
    const p = this.palette;
    this.drawWall();
    // Mọi thứ của màn (cưa dưới đáy, nước…) chỉ vẽ trong khung; chữ nổi và tên vẽ sau, được tràn ra ngoài.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 24);
    ctx.clip();
    const time = world.time;
    const level = match.level;
    for (const water of level.water ?? []) this.drawWater(water.x, water.y, water.w, water.h, now);
    for (const fan of level.fans ?? []) this.drawFan(fan.x, fan.y, fan.w, fan.h, now);
    this.drawGoal(level.goal.x, level.goal.y, level.goal.w, level.goal.h, now, visible.some((roller) => roller.roll.status === 'done'));
    (level.checkpoints ?? []).forEach((checkpoint, index) => {
      const reached = visible.find((roller) => roller.roll.checkpoint >= index);
      this.drawFlag(checkpoint.x, checkpoint.y + ROLL_RADIUS, reached?.color ?? null);
    });
    for (const platform of level.platforms) this.drawPlank(platform.a, platform.b, platform.t ?? 20, platform.bouncy ? p.bouncy : p.platform, platform.bouncy ? '#9ff0c4' : p.platformTop, Boolean(platform.bouncy));
    for (const mover of level.movers ?? []) {
      const [ox, oy] = moverOffset(mover, time);
      this.drawPlank([mover.a[0] + ox, mover.a[1] + oy], [mover.b[0] + ox, mover.b[1] + oy], mover.t ?? 20, p.mover, '#ffe2a6', false);
      this.drawMoverArrows(mover.a, mover.b, mover.move, ox, oy);
    }
    (level.seesaws ?? []).forEach((seesaw, index) => {
      const [a, b] = seesawEnds(seesaw, world.seesaws[index]!);
      ctx.fillStyle = p.platform;
      ctx.beginPath();
      ctx.moveTo(seesaw.x, seesaw.y);
      ctx.lineTo(seesaw.x - 26, seesaw.y + 70);
      ctx.lineTo(seesaw.x + 26, seesaw.y + 70);
      ctx.closePath();
      ctx.fill();
      this.drawPlank(a, b, 18, '#a07850', '#d6ab7c', false);
      ctx.fillStyle = p.platformTop;
      ctx.beginPath();
      ctx.arc(seesaw.x, seesaw.y, 7, 0, Math.PI * 2);
      ctx.fill();
    });
    for (const saw of level.saws ?? []) {
      const [sx, sy] = sawPosition(saw, time);
      if (saw.move || saw.orbit) this.drawSawTrack(saw.x, saw.y, saw.move, saw.orbit);
      this.drawSaw(sx, sy, saw.r, now);
    }

    visible.forEach((roller) => this.drawRoller(match, roller));
    ctx.restore();
    this.drawParticles(now, owner);
    this.drawFloaters(now, owner);
    visible.forEach((roller) => {
      if (roller.key !== self) this.drawTag(roller);
    });
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
  }

  private drawWall(): void {
    const ctx = this.context;
    const p = this.palette;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 24);
    ctx.fillStyle = p.wall;
    ctx.fill();
    ctx.clip();
    // Gạch ốp tường nhà vệ sinh.
    ctx.strokeStyle = p.wallLine;
    ctx.lineWidth = 2;
    for (let x = 0; x <= WORLD_WIDTH; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= WORLD_HEIGHT; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_WIDTH, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPlank(a: Point, b: Point, thickness: number, color: string, top: string, bouncy: boolean): void {
    const ctx = this.context;
    ctx.lineCap = 'round';
    ctx.strokeStyle = this.palette.shadow;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(a[0] + 4, a[1] + 6);
    ctx.lineTo(b[0] + 4, b[1] + 6);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.strokeStyle = top;
    ctx.lineWidth = Math.max(3, thickness * 0.28);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1] - thickness * 0.28);
    ctx.lineTo(b[0], b[1] - thickness * 0.28);
    ctx.stroke();
    if (bouncy) {
      // Lò xo dưới đệm nảy.
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      for (let index = 0; index < 4; index += 1) {
        const t = (index + 0.5) / 4;
        const x = a[0] + (b[0] - a[0]) * t;
        const y = a[1] + (b[1] - a[1]) * t + thickness / 2;
        ctx.beginPath();
        ctx.moveTo(x - 8, y);
        for (let zig = 1; zig <= 4; zig += 1) ctx.lineTo(x + (zig % 2 ? 8 : -8), y + zig * 6);
        ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
  }

  private drawMoverArrows(a: Point, b: Point, move: Point, ox: number, oy: number): void {
    const ctx = this.context;
    const length = Math.hypot(move[0], move[1]) || 1;
    const dx = move[0] / length;
    const dy = move[1] / length;
    // Đường ray mờ cho thấy bục sẽ đi tới đâu.
    ctx.strokeStyle = this.palette.track;
    ctx.setLineDash([10, 12]);
    ctx.lineWidth = 3;
    const cx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 30);
    ctx.lineTo(cx + move[0], cy + move[1] + 30);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const mx = cx + ox;
    const my = cy + oy;
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(mx + sign * dx * 34, my + sign * dy * 34);
      ctx.lineTo(mx + sign * dx * 22 - dy * 6, my + sign * dy * 22 + dx * 6);
      ctx.lineTo(mx + sign * dx * 22 + dy * 6, my + sign * dy * 22 - dx * 6);
      ctx.fill();
    }
  }

  private drawSawTrack(x: number, y: number, move: Point | undefined, orbit: number | undefined): void {
    const ctx = this.context;
    ctx.strokeStyle = this.palette.track;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (orbit) ctx.arc(x, y, orbit, 0, Math.PI * 2);
    else if (move) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + move[0], y + move[1]);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  private drawSaw(x: number, y: number, r: number, now: number): void {
    const ctx = this.context;
    const p = this.palette;
    const teeth = Math.max(10, Math.round(r / 4));
    const spin = now / 90;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    ctx.beginPath();
    for (let index = 0; index < teeth; index += 1) {
      const a = (index / teeth) * Math.PI * 2;
      const b = ((index + 0.5) / teeth) * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86);
      ctx.lineTo(Math.cos(b) * r, Math.sin(b) * r);
    }
    ctx.closePath();
    ctx.fillStyle = p.sawTooth;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
    ctx.fillStyle = p.saw;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    for (let index = 0; index < 3; index += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.82, (index / 3) * Math.PI * 2, (index / 3) * Math.PI * 2 + 0.9);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = '#5c6670';
    ctx.fill();
    ctx.restore();
  }

  private drawWater(x: number, y: number, w: number, h: number, now: number): void {
    const ctx = this.context;
    const p = this.palette;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    for (let wx = 0; wx <= w; wx += 20) ctx.lineTo(x + wx, y + Math.sin(now / 300 + wx / 40) * 5);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fillStyle = p.water;
    ctx.fill();
    ctx.strokeStyle = p.waterTop;
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let wx = 0; wx <= w; wx += 20) ctx.lineTo(x + wx, y + Math.sin(now / 300 + wx / 40) * 5);
    ctx.stroke();
    ctx.restore();
  }

  private drawFan(x: number, y: number, w: number, h: number, now: number): void {
    const ctx = this.context;
    const p = this.palette;
    ctx.fillStyle = 'rgba(160,200,230,0.12)';
    ctx.fillRect(x, y, w, h);
    // Vệt gió bay lên.
    ctx.strokeStyle = 'rgba(160,210,240,0.55)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let index = 0; index < 7; index += 1) {
      const lx = x + ((index + 0.5) / 7) * w;
      const offset = ((now / 6 + index * 97) % h);
      const ly = y + h - offset;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + Math.sin(now / 200 + index) * 6, ly - 46);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    // Lồng quạt ở đáy.
    ctx.fillStyle = p.fan;
    ctx.beginPath();
    ctx.roundRect(x - 6, y + h - 22, w + 12, 26, 8);
    ctx.fill();
    ctx.save();
    ctx.translate(x + w / 2, y + h - 9);
    ctx.scale(1, 0.32);
    ctx.rotate(now / 60);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let blade = 0; blade < 3; blade += 1) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.beginPath();
      ctx.ellipse(w * 0.2, 0, w * 0.2, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Đích: buồng WC có người thò tay ra xin giấy. */
  private drawGoal(x: number, y: number, w: number, h: number, now: number, happy: boolean): void {
    const ctx = this.context;
    const p = this.palette;
    // Vùng đích có thể kéo tới sát tường; cửa luôn cùng một cỡ, đặt giữa vùng.
    const doorW = Math.min(w * 0.64, 112);
    const doorX = x + (w - doorW) / 2;
    ctx.fillStyle = p.doorFrame;
    ctx.beginPath();
    ctx.roundRect(doorX - 6, y - 8, doorW + 12, h + 8, 10);
    ctx.fill();
    ctx.fillStyle = p.door;
    ctx.beginPath();
    ctx.roundRect(doorX, y, doorW, h, 6);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(doorX + doorW / 2 - 24, y + 14, 48, 26, 6);
    ctx.fill();
    ctx.fillStyle = p.doorFrame;
    ctx.font = `800 20px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WC', doorX + doorW / 2, y + 28);
    ctx.fillStyle = '#ffd36b';
    ctx.beginPath();
    ctx.arc(doorX + doorW - 12, y + h * 0.58, 5, 0, Math.PI * 2);
    ctx.fill();
    // Bàn tay vẫy ra từ khe cửa.
    const wave = Math.sin(now / 160) * 6;
    ctx.fillStyle = '#ffd1b3';
    ctx.beginPath();
    ctx.ellipse(doorX - 10, y + h * 0.42 + wave, 12, 9, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // Bong bóng thoại.
    const text = happy ? 'Cảm ơn!!' : 'Giấy ơi!';
    ctx.font = `800 22px ${FONT}`;
    const bubbleW = ctx.measureText(text).width + 24;
    const bx = Math.max(10, Math.min(WORLD_WIDTH - bubbleW - 10, x + w / 2 - bubbleW / 2));
    const by = y - 58 + Math.sin(now / 400) * 3;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(bx, by, bubbleW, 36, 14);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + w / 2 - 8, by + 34);
    ctx.lineTo(x + w / 2, by + 48);
    ctx.lineTo(x + w / 2 + 8, by + 34);
    ctx.fill();
    ctx.fillStyle = '#2d1426';
    ctx.fillText(text, bx + bubbleW / 2, by + 19);
    ctx.textBaseline = 'alphabetic';
  }

  private drawFlag(x: number, groundY: number, color: string | null): void {
    const ctx = this.context;
    ctx.strokeStyle = this.palette.platform;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.lineTo(x, groundY - 70);
    ctx.stroke();
    ctx.fillStyle = color ?? 'rgba(160,160,170,0.7)';
    ctx.beginPath();
    ctx.moveTo(x, groundY - 70);
    ctx.lineTo(x + 34, groundY - 58);
    ctx.lineTo(x, groundY - 46);
    ctx.closePath();
    ctx.fill();
  }

  private drawRoller(match: RollMatch, roller: Roller): void {
    const ctx = this.context;
    const p = this.palette;
    const roll = roller.roll;
    if (roll.status === 'dead' || roll.status === 'done') return;
    const { x, y } = roll;
    const r = ROLL_RADIUS;
    // Vòng sáng "đây là bạn" khi vừa chạm điện thoại hoặc vừa sống lại.
    const since = match.world.time - roller.touchedAt;
    if (since < 1.2) {
      const t = (since % 0.6) / 0.6;
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = roller.color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(x, y, r * (1.2 + t), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = p.shadow;
    ctx.beginPath();
    ctx.ellipse(3, r * 0.92, r * 0.85, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(roll.angle);
    // Thân cuộn giấy nhìn từ đầu: giấy trắng, vòng màu người chơi, lõi bìa có lỗ.
    ctx.fillStyle = p.paper;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = roller.color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, r - 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1.5;
    for (const ring of [0.78, 0.62]) {
      ctx.beginPath();
      ctx.arc(0, 0, r * ring, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = p.core;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a3527';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
    // Mép giấy lòi ra cho thấy cuộn đang lăn.
    ctx.fillStyle = p.paper;
    ctx.beginPath();
    ctx.moveTo(r * 0.2, -r * 0.98);
    ctx.quadraticCurveTo(r * 0.9, -r * 1.25, r * 1.18, -r * 0.6);
    ctx.lineTo(r * 0.82, -r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.stroke();
    ctx.restore();
  }

  private drawTag(roller: Roller): void {
    const roll = roller.roll;
    if (roll.status === 'dead' || roll.status === 'done') return;
    const ctx = this.context;
    const label = roller.name;
    ctx.font = `800 20px ${FONT}`;
    const width = ctx.measureText(label).width + 20;
    const x = roll.x;
    const y = roll.y - ROLL_RADIUS - 26;
    ctx.fillStyle = roller.color;
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - 14, width, 26, 13);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 6, y + 11);
    ctx.lineTo(x, y + 18);
    ctx.lineTo(x + 6, y + 11);
    ctx.fill();
    ctx.fillStyle = '#1a0a14';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
    ctx.textBaseline = 'alphabetic';
  }

  private drawParticles(now: number, owner: string | null): void {
    const ctx = this.context;
    for (const particle of this.particles) {
      if (owner && particle.owner !== owner) continue;
      const age = (now - particle.born) / 1000;
      const x = particle.x + particle.vx * age;
      const y = particle.y + particle.vy * age + 0.5 * particle.gravity * age * age;
      ctx.globalAlpha = Math.max(0, 1 - (now - particle.born) / particle.life);
      ctx.fillStyle = particle.color;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(particle.spin * age);
      ctx.fillRect(-particle.size / 2, -particle.size / 3, particle.size, particle.size * 0.66);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private drawFloaters(now: number, owner: string | null): void {
    const ctx = this.context;
    ctx.textAlign = 'center';
    for (const floater of this.floaters) {
      if (owner && floater.owner !== owner) continue;
      const age = (now - floater.born) / 1100;
      ctx.globalAlpha = Math.max(0, 1 - age * age);
      ctx.font = `800 ${Math.round(34 * (age < 0.1 ? 0.7 + age * 3 : 1))}px ${FONT}`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(20,4,16,0.65)';
      const y = floater.y - age * 50;
      ctx.strokeText(floater.text, floater.x, y);
      ctx.fillStyle = floater.color;
      ctx.fillText(floater.text, floater.x, y);
    }
    ctx.globalAlpha = 1;
  }

  private floater(x: number, y: number, text: string, color: string, now: number, owner: string | null = null): void {
    this.floaters.push({ x: Math.max(80, Math.min(WORLD_WIDTH - 80, x)), y: Math.max(60, y), text, color, born: now, owner });
  }

  private burst(x: number, y: number, count: number, colors: string[], speed: number, now: number, life: number, owner: string | null = null): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity - speed * 0.4, spin: (Math.random() - 0.5) * 18,
        born: now, life: life * (0.6 + Math.random() * 0.4), color: colors[index % colors.length]!, size: 6 + Math.random() * 8, gravity: 900, owner,
      });
    }
  }

  private readonly resize = (): void => {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const width = Math.max(200, this.width - this.inset - 40);
    const height = Math.max(200, this.height - TOP_MARGIN - BOTTOM_MARGIN);
    this.scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    this.originX = this.inset + 20 + (width - WORLD_WIDTH * this.scale) / 2;
    this.originY = TOP_MARGIN + (height - WORLD_HEIGHT * this.scale) / 2;
  };
}
