import type { ThemeMode } from '../ui/theme';
import { LANE_WIDTH, MARBLE_RADIUS, sweeperX, type Obstacle } from './course';
import type { MarbleRace, RaceEvent } from './MarbleRace';

interface Palette {
  laneTop: string;
  laneBottom: string;
  stripe: string;
  rail: string;
  block: string;
  blockTop: string;
  blockShadow: string;
  sweeper: string;
  hole: string;
  holeRim: string;
  boost: string;
  gem: string;
  text: string;
  textSoft: string;
  hud: string;
  warning: string;
}

const DARK: Palette = {
  laneTop: '#2b112a', laneBottom: '#1a0a1b', stripe: 'rgba(255,190,225,0.07)', rail: 'rgba(255,120,189,0.38)',
  block: '#55275a', blockTop: '#7a3d80', blockShadow: 'rgba(0,0,0,0.45)', sweeper: '#ff8a4c',
  hole: '#050208', holeRim: '#ffb36b', boost: '#58e39a', gem: '#7fe7ff',
  text: '#fff4fb', textSoft: '#c9a9bf', hud: 'rgba(19,8,20,0.78)', warning: '#ffb36b',
};

const LIGHT: Palette = {
  laneTop: '#fff8fc', laneBottom: '#f6e2ee', stripe: 'rgba(105,42,82,0.07)', rail: 'rgba(234,67,153,0.4)',
  block: '#c98fb2', blockTop: '#e8c3d8', blockShadow: 'rgba(92,28,66,0.25)', sweeper: '#f0703a',
  hole: '#1c0a17', holeRim: '#e08a1e', boost: '#22a865', gem: '#119bd0',
  text: '#2d1426', textSoft: '#74586a', hud: 'rgba(255,249,252,0.9)', warning: '#c76a12',
};

const TOP_MARGIN = 92;
const BOTTOM_MARGIN = 18;
const LANE_GAP = 14;
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

interface Floater { lane: number; x: number; y: number; text: string; color: string; born: number }
interface Spark { lane: number; x: number; y: number; vx: number; vy: number; born: number; life: number; color: string }

export class MarbleRenderer {
  readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private palette = DARK;
  private cameras: number[] = [];
  private shakes: number[] = [];
  private floaters: Floater[] = [];
  private sparks: Spark[] = [];
  private width = 1;
  private height = 1;

  constructor(private readonly container: HTMLElement) {
    this.canvas.className = 'race-canvas';
    container.append(this.canvas);
    this.context = this.canvas.getContext('2d')!;
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  setTheme(theme: ThemeMode): void {
    this.palette = theme === 'light' ? LIGHT : DARK;
  }

  reset(): void {
    this.cameras = [];
    this.shakes = [];
    this.floaters = [];
    this.sparks = [];
  }

  /** Hiệu ứng ngắn cho sự kiện vật lý: chữ nổi, tia sáng, rung làn. */
  effect(race: MarbleRace, event: RaceEvent, now: number): void {
    const racer = race.racers[event.racer];
    if (!racer) return;
    const { x, y } = racer.marble;
    const floater = (text: string, color: string) => this.floaters.push({ lane: event.racer, x, y, text, color, born: now });
    const burst = (count: number, color: string, speed: number) => {
      for (let index = 0; index < count; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const velocity = speed * (0.4 + Math.random() * 0.8);
        this.sparks.push({ lane: event.racer, x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, born: now, life: 500 + Math.random() * 400, color });
      }
    };
    if (event.type === 'gem') { floater('+◆', this.palette.gem); burst(8, this.palette.gem, 40); }
    if (event.type === 'fall') floater('RƠI HỐ!', this.palette.warning);
    if (event.type === 'drop') { floater('RƠI BI KHỎI KHAY!', this.palette.warning); this.shakes[event.racer] = 0.4; }
    if (event.type === 'bump') this.shakes[event.racer] = 0.25;
    if (event.type === 'boost') floater('TĂNG TỐC!', this.palette.boost);
    if (event.type === 'finish') { floater('VỀ ĐÍCH!', racer.color); burst(26, racer.color, 70); }
  }

  render(race: MarbleRace | null, now: number, elapsed: number): void {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);
    if (!race) return;
    const count = race.racers.length;
    const laneHeight = this.height - TOP_MARGIN - BOTTOM_MARGIN;
    const available = this.width - 40 - LANE_GAP * (count - 1);
    const laneWidth = Math.max(120, Math.min(available / count, laneHeight * 0.62, 560));
    const total = laneWidth * count + LANE_GAP * (count - 1);
    const startX = (this.width - total) / 2;
    const ranks = new Map(race.ranking().map((racer, rank) => [racer, rank + 1]));

    this.floaters = this.floaters.filter((floater) => now - floater.born < 1_100);
    this.sparks = this.sparks.filter((spark) => now - spark.born < spark.life);

    race.racers.forEach((racer, index) => {
      const marble = racer.marble;
      const previous = this.cameras[index];
      // Camera bám mượt theo bi; sau khi rơi hố và đặt lại thì nhảy thẳng tới.
      this.cameras[index] = previous === undefined || Math.abs(previous - marble.y) > 140
        ? marble.y
        : previous + (marble.y - previous) * Math.min(1, elapsed * 9);
      this.shakes[index] = Math.max(0, (this.shakes[index] ?? 0) - elapsed);
      const shake = (this.shakes[index] ?? 0) * 18;
      const left = startX + index * (laneWidth + LANE_GAP) + (shake ? (Math.random() - 0.5) * shake : 0);
      this.drawLane(race, index, left, TOP_MARGIN, laneWidth, laneHeight, ranks.get(index) ?? index + 1, now);
    });

    if (race.phase === 'countdown') this.drawCountdown(race.time, now);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
  }

  private drawLane(race: MarbleRace, index: number, left: number, top: number, width: number, height: number, rank: number, now: number): void {
    const ctx = this.context;
    const p = this.palette;
    const racer = race.racers[index]!;
    const marble = racer.marble;
    const scale = width / LANE_WIDTH;
    const camera = this.cameras[index] ?? 0;
    const anchor = top + height * 0.74;
    const sy = (worldY: number) => anchor - (worldY - camera) * scale;
    const sx = (worldX: number) => left + worldX * scale;
    const minY = camera - (height * 0.26) / scale - 10;
    const maxY = camera + (height * 0.74) / scale + 10;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, top, width, height, 18);
    const gradient = ctx.createLinearGradient(0, top, 0, top + height);
    gradient.addColorStop(0, p.laneTop);
    gradient.addColorStop(1, p.laneBottom);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.clip();

    // Vạch ngang chạy ngược chiều để cảm nhận tốc độ.
    ctx.strokeStyle = p.stripe;
    ctx.lineWidth = Math.max(1, scale * 0.6);
    for (let y = Math.floor(minY / 40) * 40; y < maxY; y += 40) {
      ctx.beginPath();
      ctx.moveTo(left, sy(y));
      ctx.lineTo(left + width, sy(y));
      ctx.stroke();
    }
    ctx.fillStyle = p.rail;
    ctx.fillRect(left, top, Math.max(2, scale * 0.9), height);
    ctx.fillRect(left + width - Math.max(2, scale * 0.9), top, Math.max(2, scale * 0.9), height);

    this.drawCheckerLine(left, sy(0), width, scale, 0.35);
    this.drawCheckerLine(left, sy(race.course.length), width, scale, 1);

    for (const obstacle of race.course.obstacles) {
      if (obstacle.y > maxY) break;
      const extent = 'h' in obstacle ? obstacle.h : 0;
      if (obstacle.y + extent < minY) continue;
      this.drawObstacle(obstacle, racer.marble.collected, race.time, sx, sy, scale, now);
    }

    this.sparks.filter((spark) => spark.lane === index).forEach((spark) => {
      const age = (now - spark.born) / 1000;
      ctx.globalAlpha = Math.max(0, 1 - (now - spark.born) / spark.life);
      ctx.fillStyle = spark.color;
      ctx.beginPath();
      ctx.arc(sx(spark.x + spark.vx * age), sy(spark.y + spark.vy * age), Math.max(1.5, scale * 0.8), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    this.drawMarble(racer.color, marble, sx(marble.x), sy(marble.y), scale, now);

    this.floaters.filter((floater) => floater.lane === index).forEach((floater) => {
      const age = (now - floater.born) / 1100;
      ctx.globalAlpha = Math.max(0, 1 - age * age);
      ctx.fillStyle = floater.color;
      ctx.font = `800 ${Math.max(16, scale * 6)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(floater.text, sx(Math.max(18, Math.min(LANE_WIDTH - 18, floater.x))), sy(floater.y) - 26 - age * 40);
    });
    ctx.globalAlpha = 1;
    ctx.restore();

    this.drawLaneHud(race, index, left, top, width, height, rank);
  }

  private drawCheckerLine(left: number, y: number, width: number, scale: number, alpha: number): void {
    const ctx = this.context;
    const size = Math.max(6, scale * 4);
    ctx.globalAlpha = alpha;
    for (let column = 0; column * size < width; column += 1) {
      for (let row = 0; row < 2; row += 1) {
        ctx.fillStyle = (column + row) % 2 ? '#ffffff' : '#1a0a14';
        ctx.fillRect(left + column * size, y - size * (row + 1), size, size);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawObstacle(
    obstacle: Obstacle,
    collected: Set<number>,
    time: number,
    sx: (x: number) => number,
    sy: (y: number) => number,
    scale: number,
    now: number,
  ): void {
    const ctx = this.context;
    const p = this.palette;
    if (obstacle.kind === 'gem') {
      if (collected.has(obstacle.id)) return;
      const bob = Math.sin(now / 220 + obstacle.id) * scale * 0.8;
      const size = scale * 3.2;
      const cx = sx(obstacle.x);
      const cy = sy(obstacle.y) + bob;
      ctx.fillStyle = p.gem;
      ctx.shadowColor = p.gem;
      ctx.shadowBlur = scale * 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx + size * 0.75, cy);
      ctx.lineTo(cx, cy + size);
      ctx.lineTo(cx - size * 0.75, cy);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.moveTo(cx, cy - size * 0.75);
      ctx.lineTo(cx + size * 0.3, cy - size * 0.1);
      ctx.lineTo(cx - size * 0.2, cy - size * 0.1);
      ctx.closePath();
      ctx.fill();
      return;
    }
    const x = obstacle.kind === 'sweeper' ? sweeperX(obstacle, time) : obstacle.x;
    const left = sx(x);
    const right = sx(x + obstacle.w);
    const top = sy(obstacle.y + obstacle.h);
    const bottom = sy(obstacle.y);
    const width = right - left;
    const height = bottom - top;
    if (obstacle.kind === 'hole') {
      // Hố có viền sọc cảnh báo và bóng đổ phía trong để không nhầm với khối chắn.
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(left, top, width, height, scale * 3);
      ctx.fillStyle = p.hole;
      ctx.fill();
      ctx.clip();
      const depth = ctx.createLinearGradient(0, top, 0, bottom);
      depth.addColorStop(0, 'rgba(0,0,0,0)');
      depth.addColorStop(0.55, 'rgba(0,0,0,0.25)');
      depth.addColorStop(1, 'rgba(0,0,0,0.65)');
      ctx.fillStyle = depth;
      ctx.fillRect(left, top, width, height);
      ctx.restore();
      ctx.save();
      ctx.lineWidth = Math.max(2, scale * 1.2);
      ctx.setLineDash([scale * 3, scale * 2.4]);
      ctx.strokeStyle = p.holeRim;
      ctx.beginPath();
      ctx.roundRect(left, top, width, height, scale * 3);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (obstacle.kind === 'boost') {
      ctx.fillStyle = `${p.boost}33`;
      ctx.beginPath();
      ctx.roundRect(left, top, width, height, scale * 2);
      ctx.fill();
      ctx.strokeStyle = p.boost;
      ctx.lineWidth = Math.max(2, scale * 1.1);
      const offset = ((now / 400) % 1) * (height / 3);
      for (let row = 0; row < 3; row += 1) {
        const y = bottom - offset - row * (height / 3) - height * 0.1;
        if (y < top + height * 0.12) continue;
        ctx.beginPath();
        ctx.moveTo(left + width * 0.2, y);
        ctx.lineTo(left + width * 0.5, y - height * 0.16);
        ctx.lineTo(left + width * 0.8, y);
        ctx.stroke();
      }
      return;
    }
    const lift = scale * 1.6;
    ctx.fillStyle = p.blockShadow;
    ctx.beginPath();
    ctx.roundRect(left + lift * 0.6, top + lift, width, height, scale * 1.5);
    ctx.fill();
    ctx.fillStyle = obstacle.kind === 'sweeper' ? p.sweeper : p.block;
    ctx.beginPath();
    ctx.roundRect(left, top, width, height, scale * 1.5);
    ctx.fill();
    ctx.fillStyle = obstacle.kind === 'sweeper' ? 'rgba(255,255,255,0.28)' : p.blockTop;
    ctx.beginPath();
    ctx.roundRect(left + scale * 0.8, top + scale * 0.8, Math.max(0, width - scale * 1.6), Math.max(0, height * 0.42), scale);
    ctx.fill();
  }

  private drawMarble(color: string, marble: MarbleRace['racers'][number]['marble'], x: number, y: number, scale: number, now: number): void {
    const ctx = this.context;
    let radius = MARBLE_RADIUS * scale * (1 + marble.z / 45);
    let alpha = 1;
    if (marble.status === 'falling') {
      const t = Math.max(0, marble.fallTimer / 0.8);
      radius *= t;
      alpha = t;
    }
    const lift = marble.z * scale * 0.55;
    ctx.globalAlpha = alpha * 0.45;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x + scale * 0.8, y + scale * 1.2, MARBLE_RADIUS * scale * (1 - Math.min(0.5, marble.z / 60)), MARBLE_RADIUS * scale * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
    if (radius < 0.5) {
      ctx.globalAlpha = 1;
      return;
    }
    const cy = y - lift;
    if (marble.boost > 0) {
      ctx.fillStyle = `${color}55`;
      ctx.beginPath();
      ctx.moveTo(x - radius * 0.9, cy);
      ctx.lineTo(x, cy + radius * 4.5);
      ctx.lineTo(x + radius * 0.9, cy);
      ctx.fill();
    }
    const body = ctx.createRadialGradient(x - radius * 0.35, cy - radius * 0.4, radius * 0.1, x, cy, radius);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.25, color);
    body.addColorStop(1, shade(color, -0.45));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    // Dải xoáy bên trong viên bi lăn theo quãng đường.
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = radius * 0.28;
    const band = Math.sin(marble.roll) * radius * 0.85;
    ctx.beginPath();
    ctx.ellipse(x, cy + band, radius * 1.05, radius * 0.3 * Math.abs(Math.cos(marble.roll)) + radius * 0.05, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    if (marble.stun > 0) {
      ctx.fillStyle = this.palette.warning;
      for (let star = 0; star < 3; star += 1) {
        const angle = now / 160 + (star * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * radius * 1.5, cy - radius * 1.3 + Math.sin(angle) * radius * 0.4, Math.max(2, radius * 0.22), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawLaneHud(race: MarbleRace, index: number, left: number, top: number, width: number, height: number, rank: number): void {
    const ctx = this.context;
    const p = this.palette;
    const racer = race.racers[index]!;
    const marble = racer.marble;
    const pad = 10;

    // Tên + hạng + ngọc.
    ctx.fillStyle = p.hud;
    ctx.beginPath();
    ctx.roundRect(left + pad, top + pad, width - pad * 2, 38, 12);
    ctx.fill();
    const medal = ['#ffc23d', '#d8d8e6', '#e0a070'][rank - 1] ?? p.textSoft;
    ctx.fillStyle = medal;
    ctx.beginPath();
    ctx.arc(left + pad + 20, top + pad + 19, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0a14';
    ctx.font = `800 16px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(rank), left + pad + 20, top + pad + 20);
    ctx.textAlign = 'left';
    ctx.fillStyle = racer.color;
    ctx.fillRect(left + pad + 40, top + pad + 11, 4, 16);
    ctx.fillStyle = p.text;
    ctx.font = `700 ${width < 200 ? 14 : 17}px ${FONT}`;
    const gemsLabel = `◆ ${marble.collected.size}`;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left + pad + 50, top + pad, width - pad * 2 - 100, 38);
    ctx.clip();
    ctx.fillText(racer.name, left + pad + 50, top + pad + 20);
    ctx.restore();
    ctx.textAlign = 'right';
    ctx.fillStyle = p.gem;
    ctx.fillText(gemsLabel, left + width - pad - 10, top + pad + 20);

    // Tiến độ của mọi người: chấm màu dọc mép phải làn.
    const barTop = top + 60;
    const barBottom = top + height - 54;
    const barX = left + width - 9;
    ctx.fillStyle = p.stripe;
    ctx.fillRect(barX - 1.5, barTop, 3, barBottom - barTop);
    race.racers.forEach((other, otherIndex) => {
      const progress = Math.max(0, Math.min(1, other.marble.y / race.course.length));
      ctx.fillStyle = other.color;
      ctx.globalAlpha = otherIndex === index ? 1 : 0.65;
      ctx.beginPath();
      ctx.arc(barX, barBottom - progress * (barBottom - barTop), otherIndex === index ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Khay giữ bi (thay cho cuộn giấy trên tấm bìa): lệch nhiều là sắp rơi.
    const trayWidth = Math.min(150, width - 40);
    const trayX = left + (width - trayWidth) / 2;
    const trayY = top + height - 30;
    const danger = Math.abs(racer.tray.position);
    ctx.fillStyle = p.hud;
    ctx.beginPath();
    ctx.roundRect(trayX - 6, trayY - 11, trayWidth + 12, 22, 11);
    ctx.fill();
    ctx.fillStyle = danger > 0.72 ? p.warning : p.stripe;
    ctx.fillRect(trayX, trayY - 2, trayWidth, 4);
    ctx.fillStyle = racer.color;
    ctx.beginPath();
    ctx.arc(trayX + trayWidth / 2 + racer.tray.position * (trayWidth / 2 - 6), trayY, 6, 0, Math.PI * 2);
    ctx.fill();

    if (marble.status === 'finished') {
      ctx.fillStyle = p.hud;
      ctx.beginPath();
      ctx.roundRect(left + pad, top + height * 0.36, width - pad * 2, 74, 16);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = racer.color;
      ctx.font = `800 ${Math.min(34, width / 6)}px ${FONT}`;
      ctx.fillText(`VỀ ĐÍCH #${rank}`, left + width / 2, top + height * 0.36 + 28);
      ctx.fillStyle = p.text;
      ctx.font = `700 17px ${FONT}`;
      const score = race.score(racer);
      ctx.fillText(`${formatSeconds(score ?? 0)} (−${marble.collected.size} ◆)`, left + width / 2, top + height * 0.36 + 56);
    }
    ctx.textBaseline = 'alphabetic';
  }

  private drawCountdown(time: number, now: number): void {
    const ctx = this.context;
    const remaining = Math.ceil(-time);
    const fraction = -time - Math.floor(-time);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.35 + fraction * 0.65;
    ctx.font = `800 ${Math.min(this.width, this.height) * (0.22 + fraction * 0.08)}px ${FONT}`;
    ctx.fillStyle = this.palette.text;
    ctx.shadowColor = '#ff5caf';
    ctx.shadowBlur = 40;
    ctx.fillText(remaining > 0 ? String(remaining) : 'GO!', this.width / 2, this.height * 0.5 + Math.sin(now / 90) * 2);
    ctx.restore();
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
  };
}

export function formatSeconds(value: number): string {
  return `${value.toFixed(1)}s`;
}

/** Làm tối/sáng màu hex theo tỉ lệ (-1..1). */
function shade(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const base = (value >> shift) & 255;
    return Math.round(amount < 0 ? base * (1 + amount) : base + (255 - base) * amount);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
