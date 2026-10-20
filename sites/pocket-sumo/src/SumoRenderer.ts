import type { ThemeMode } from '@pocket/party-kit';
import { ARENA_RADIUS, BUMPER_RADIUS, DASH_COOLDOWN, FIGHTER_RADIUS, PUFF_RANGE, type Fighter } from './physics';
import { MIN_RADIUS, RING_WIDTH, type MatchEvent, type SumoMatch } from './SumoMatch';

interface Palette {
  skyTop: string;
  skyBottom: string;
  glow: string;
  mote: string;
  top: string;
  ring: string;
  side: string;
  sideDark: string;
  iceTop: string;
  iceRing: string;
  iceSide: string;
  iceSideDark: string;
  rope: string;
  mark: string;
  warning: string;
  shadow: string;
  text: string;
  tag: string;
  bumper: string;
}

const DARK: Palette = {
  skyTop: '#22092a', skyBottom: '#06030a', glow: 'rgba(255,92,175,0.2)', mote: 'rgba(255,190,225,0.5)',
  top: '#e9bb8b', ring: '#ddab79', side: '#8a5233', sideDark: '#3e2015',
  iceTop: '#c9efff', iceRing: '#aee0f7', iceSide: '#4b88ad', iceSideDark: '#18344a',
  rope: '#f7e6b5', mark: 'rgba(255,255,255,0.85)', warning: '#ff4d5e', shadow: 'rgba(20,4,16,0.38)',
  text: '#fff4fb', tag: '#1a0a14', bumper: '#58e39a',
};

const LIGHT: Palette = {
  skyTop: '#ffeef7', skyBottom: '#f3cfe2', glow: 'rgba(255,92,175,0.18)', mote: 'rgba(190,60,130,0.28)',
  top: '#f0c697', ring: '#e5b483', side: '#b67a52', sideDark: '#6e3f26',
  iceTop: '#d9f5ff', iceRing: '#bde8fa', iceSide: '#6aa6c9', iceSideDark: '#2f5d7a',
  rope: '#fff3cc', mark: 'rgba(255,255,255,0.95)', warning: '#ec2f4a', shadow: 'rgba(92,28,66,0.25)',
  text: '#2d1426', tag: '#1a0a14', bumper: '#22a865',
};

/** Mặt sàn được nhìn nghiêng: trục y bị nén lại để thấy được độ dày của sàn. */
const TILT = 0.56;
const TOP_MARGIN = 96;
const BOTTOM_MARGIN = 132;
const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';

interface Floater { x: number; y: number; text: string; color: string; born: number; size: number }
interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; born: number; life: number; color: string; size: number; kind: 'dust' | 'spark' | 'confetti' }
interface Chunk { angle: number; span: number; inner: number; outer: number; born: number; spin: number; drift: number }
interface Ring { x: number; y: number; born: number; color: string; radius: number }

export class SumoRenderer {
  readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private palette = DARK;
  private width = 1;
  private height = 1;
  private scale = 1;
  /** Phần bên trái bị sảnh chờ che; sàn được căn giữa phần còn lại. */
  private inset = 0;
  private cx = 0;
  private cy = 0;
  private thickness = 40;
  private shake = 0;
  private floaters: Floater[] = [];
  private particles: Particle[] = [];
  private chunks: Chunk[] = [];
  private rings: Ring[] = [];
  private bumperFlash = new Map<number, number>();
  private readonly motes = Array.from({ length: 36 }, () => ({ x: Math.random(), y: Math.random(), speed: 0.004 + Math.random() * 0.01, size: 1 + Math.random() * 2.2 }));

  constructor(private readonly container: HTMLElement) {
    this.canvas.className = 'arena-canvas';
    container.append(this.canvas);
    this.context = this.canvas.getContext('2d')!;
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  setTheme(theme: ThemeMode): void {
    this.palette = theme === 'light' ? LIGHT : DARK;
  }

  setInset(left: number): void {
    if (left === this.inset) return;
    this.inset = left;
    this.resize();
  }

  reset(): void {
    this.floaters = [];
    this.particles = [];
    this.chunks = [];
    this.rings = [];
    this.shake = 0;
  }

  /** Hiệu ứng ngắn cho sự kiện: chữ nổi, bụi, tia va chạm, mảnh sàn rơi, rung màn hình. */
  effect(match: SumoMatch, event: MatchEvent, now: number): void {
    const p = this.palette;
    const color = 'key' in event ? match.fighter(event.key)?.color ?? p.text : p.text;
    if (event.type === 'dash') {
      this.burst(event.x, event.y, 7, 'rgba(255,240,220,0.7)', 90, now, 'dust');
    } else if (event.type === 'bump') {
      const strong = event.strength > 0.7;
      this.burst(event.x, event.y, strong ? 16 : 7, strong ? '#ffd36b' : '#ffffff', strong ? 260 : 150, now, 'spark');
      this.floater(event.x, event.y, strong ? 'BỐP!' : 'BỤP!', strong ? '#ffd36b' : p.text, now, strong ? 1.3 : 0.9);
      this.shake = Math.max(this.shake, strong ? 0.35 : 0.12);
    } else if (event.type === 'clash') {
      this.burst(event.x, event.y, 22, '#7fe7ff', 300, now, 'spark');
      this.floater(event.x, event.y, 'CHAN!', '#7fe7ff', now, 1.4);
      this.shake = Math.max(this.shake, 0.45);
    } else if (event.type === 'bumper') {
      this.burst(event.x, event.y, 10, p.bumper, 220, now, 'spark');
      this.floater(event.x, event.y, 'BOING!', p.bumper, now, 1);
      match.world.rules.bumpers.forEach((bumper, index) => {
        if (Math.hypot(bumper.x - event.x, bumper.y - event.y) < BUMPER_RADIUS + FIGHTER_RADIUS + 4) this.bumperFlash.set(index, now);
      });
      this.shake = Math.max(this.shake, 0.18);
    } else if (event.type === 'fall') {
      this.floater(event.x, event.y, event.other ? 'KO!' : 'Á Á Á!', event.other ? match.fighter(event.other)?.color ?? color : color, now, 1.2);
    } else if (event.type === 'puff') {
      this.rings.push({ x: event.x, y: event.y, born: now, color, radius: PUFF_RANGE + FIGHTER_RADIUS });
      this.floater(event.x, event.y, 'PHÙ!', color, now, 0.9);
    } else if (event.type === 'crumble') {
      const pieces = 26;
      for (let index = 0; index < pieces; index += 1) {
        this.chunks.push({
          angle: (index / pieces) * Math.PI * 2, span: (Math.PI * 2) / pieces, inner: event.to, outer: event.from,
          born: now + Math.random() * 260, spin: (Math.random() - 0.5) * 0.6, drift: 0.85 + Math.random() * 0.4,
        });
      }
      this.shake = Math.max(this.shake, 0.5);
    } else if (event.type === 'spawn') {
      const fighter = match.fighter(event.key);
      if (fighter) this.rings.push({ x: fighter.x, y: fighter.y, born: now, color: fighter.color, radius: FIGHTER_RADIUS * 2.2 });
    } else if (event.type === 'roundEnd' || event.type === 'matchEnd') {
      const fighter = event.winner ? match.fighter(event.winner) : undefined;
      if (fighter) this.confetti(fighter.x, fighter.y, fighter.color, now, event.type === 'matchEnd' ? 70 : 40);
    }
  }

  render(match: SumoMatch, now: number, elapsed: number): void {
    const ctx = this.context;
    this.shake = Math.max(0, this.shake - elapsed);
    this.floaters = this.floaters.filter((floater) => now - floater.born < 1_000);
    this.particles = this.particles.filter((particle) => now - particle.born < particle.life);
    this.chunks = this.chunks.filter((chunk) => now - chunk.born < 1_600);
    this.rings = this.rings.filter((ring) => now - ring.born < 600);

    this.drawSky(now);
    ctx.save();
    if (this.shake > 0) {
      const amount = this.shake * 16;
      ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
    }

    // Người rơi ở mép xa bị sàn che, người rơi ở mép gần rơi trước mặt sàn.
    const fighters = [...match.fighters].sort((a, b) => a.y - b.y);
    fighters.filter((fighter) => fighter.status === 'falling' && fighter.y < 0).forEach((fighter) => this.drawFighter(match, fighter, now));
    this.drawChunks(match, now, true);
    this.drawArena(match, now);
    this.drawRings(now);
    fighters.filter((fighter) => fighter.status === 'alive').forEach((fighter) => this.drawFloorMarks(match, fighter));
    this.drawBumperShadows(match);

    const standing = fighters.filter((fighter) => fighter.status === 'alive');
    const bumpers = match.world.rules.bumpers.map((bumper, index) => ({ y: bumper.y, index }));
    // Vẽ theo chiều sâu: cột nảy và người xen kẽ theo y.
    let bumperCursor = 0;
    const sortedBumpers = bumpers.sort((a, b) => a.y - b.y);
    for (const fighter of standing) {
      while (bumperCursor < sortedBumpers.length && sortedBumpers[bumperCursor]!.y < fighter.y) {
        this.drawBumper(match, sortedBumpers[bumperCursor]!.index, now);
        bumperCursor += 1;
      }
      this.drawFighter(match, fighter, now);
    }
    while (bumperCursor < sortedBumpers.length) this.drawBumper(match, sortedBumpers[bumperCursor++]!.index, now);

    fighters.filter((fighter) => fighter.status === 'falling' && fighter.y >= 0).forEach((fighter) => this.drawFighter(match, fighter, now));
    this.drawChunks(match, now, false);
    this.drawParticles(now);
    fighters.filter((fighter) => fighter.status === 'ghost').forEach((fighter) => this.drawFighter(match, fighter, now));
    standing.forEach((fighter) => this.drawNameTag(fighter));
    this.drawFloaters(now);
    ctx.restore();
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
  }

  private project(x: number, y: number, z = 0): [number, number] {
    return [this.cx + x * this.scale, this.cy + y * this.scale * TILT - z * this.scale];
  }

  private drawSky(now: number): void {
    const ctx = this.context;
    const p = this.palette;
    const sky = ctx.createLinearGradient(0, 0, 0, this.height);
    sky.addColorStop(0, p.skyTop);
    sky.addColorStop(1, p.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.width, this.height);
    const glow = ctx.createRadialGradient(this.cx, this.cy + this.thickness, 0, this.cx, this.cy + this.thickness, ARENA_RADIUS * this.scale * 1.5);
    glow.addColorStop(0, p.glow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = p.mote;
    for (const mote of this.motes) {
      const y = (mote.y - (now / 1000) * mote.speed) % 1;
      const wrapped = y < 0 ? y + 1 : y;
      ctx.globalAlpha = 0.25 + 0.5 * Math.sin(now / 900 + mote.x * 20) ** 2;
      ctx.beginPath();
      ctx.arc(mote.x * this.width, wrapped * this.height, mote.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawArena(match: SumoMatch, now: number): void {
    const ctx = this.context;
    const p = this.palette;
    const ice = match.world.rules.ice;
    const radius = match.world.radius;
    if (radius <= 0.5) return;
    const rx = radius * this.scale;
    const ry = rx * TILT;
    const { cx, cy, thickness } = this;

    // Thân sàn (hình trụ): elip đáy + khối chữ nhật, rồi phủ mặt trên.
    const side = ctx.createLinearGradient(0, cy, 0, cy + thickness + ry);
    side.addColorStop(0, ice ? p.iceSide : p.side);
    side.addColorStop(1, ice ? p.iceSideDark : p.sideDark);
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.ellipse(cx, cy + thickness, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - rx, cy, rx * 2, thickness);
    // Vân dọc trên thân sàn.
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = Math.max(1, this.scale);
    for (let index = 1; index < 12; index += 1) {
      const x = cx - rx + (rx * 2 * index) / 12;
      const offset = Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2)) * ry;
      ctx.beginPath();
      ctx.moveTo(x, cy + offset);
      ctx.lineTo(x, cy + offset + thickness);
      ctx.stroke();
    }

    // Mặt sàn với các vòng sẽ sụp dần.
    ctx.fillStyle = ice ? p.iceTop : p.top;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let band = ARENA_RADIUS; band > MIN_RADIUS; band -= RING_WIDTH) {
      if (band > radius + 0.5) continue;
      const odd = Math.round((ARENA_RADIUS - band) / RING_WIDTH) % 2 === 0;
      if (!odd) continue;
      const outer = Math.min(radius, band);
      const inner = band - RING_WIDTH;
      ctx.fillStyle = ice ? p.iceRing : p.ring;
      ctx.beginPath();
      ctx.ellipse(cx, cy, outer * this.scale, outer * this.scale * TILT, 0, 0, Math.PI * 2);
      ctx.ellipse(cx, cy, inner * this.scale, inner * this.scale * TILT, 0, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    }
    if (ice) {
      // Vệt bóng loáng trên sàn băng.
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = this.scale * 6;
      for (let index = -2; index <= 2; index += 1) {
        const shift = ((now / 40) % (rx * 2)) - rx;
        ctx.beginPath();
        ctx.moveTo(cx + index * rx * 0.45 + shift - ry, cy - ry);
        ctx.lineTo(cx + index * rx * 0.45 + shift + ry, cy + ry);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Vòng rơm ở vòng trong cùng và hai vạch xuất phát như sàn sumo thật.
    if (radius > MIN_RADIUS * 0.9) {
      const rope = Math.min(MIN_RADIUS, radius) * this.scale;
      ctx.strokeStyle = p.rope;
      ctx.lineWidth = this.scale * 5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rope, rope * TILT, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120,70,30,0.25)';
      ctx.lineWidth = this.scale * 1.5;
      ctx.stroke();
    }
    ctx.strokeStyle = p.mark;
    ctx.lineWidth = this.scale * 3;
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      const [x1, y1] = this.project(-14, sign * 20);
      const [x2, y2] = this.project(14, sign * 20);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Mép sàn sáng lên.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = Math.max(1.5, this.scale * 1.5);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Cảnh báo: vòng ngoài nhấp nháy đỏ, càng gần lúc sụp càng nhanh.
    const warning = match.warning;
    if (warning > 0 && match.nextRadius < radius) {
      const speed = 4 + (1 - warning) * 14;
      const pulse = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin((now / 1000) * speed * Math.PI));
      const inner = match.nextRadius * this.scale;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = p.warning;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.ellipse(cx, cy, inner, inner * TILT, 0, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = Math.max(1, this.scale * 1.2);
      ctx.setLineDash([this.scale * 8, this.scale * 6]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, inner, inner * TILT, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawChunks(match: SumoMatch, now: number, back: boolean): void {
    const ctx = this.context;
    const p = this.palette;
    const ice = match.world.rules.ice;
    for (const chunk of this.chunks) {
      const age = (now - chunk.born) / 1000;
      if (age < 0) continue;
      const mid = chunk.angle + chunk.span / 2;
      if ((Math.sin(mid) < 0) !== back) continue;
      const drop = 380 * age * age * chunk.drift;
      ctx.globalAlpha = Math.max(0, 1 - age / 1.5);
      ctx.fillStyle = ice ? p.iceSide : p.side;
      ctx.save();
      const [ox, oy] = this.project(Math.cos(mid) * chunk.outer, Math.sin(mid) * chunk.outer);
      ctx.translate(ox, oy + drop * this.scale * 0.6);
      ctx.rotate(chunk.spin * age * 3);
      ctx.translate(-ox, -oy);
      ctx.beginPath();
      for (let step = 0; step <= 4; step += 1) {
        const angle = chunk.angle + (chunk.span * step) / 4;
        const [x, y] = this.project(Math.cos(angle) * chunk.outer, Math.sin(angle) * chunk.outer);
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let step = 4; step >= 0; step -= 1) {
        const angle = chunk.angle + (chunk.span * step) / 4;
        const [x, y] = this.project(Math.cos(angle) * chunk.inner, Math.sin(angle) * chunk.inner);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = ice ? p.iceTop : p.top;
      ctx.translate(0, -this.thickness * 0.25);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** Bóng đổ của cột nảy nằm trên sàn, vẽ trước người. */
  private drawBumperShadows(match: SumoMatch): void {
    const ctx = this.context;
    ctx.fillStyle = this.palette.shadow;
    match.world.rules.bumpers.forEach((bumper) => {
      const [x, y] = this.project(bumper.x + 4, bumper.y + 6);
      ctx.beginPath();
      ctx.ellipse(x, y, BUMPER_RADIUS * this.scale * 1.05, BUMPER_RADIUS * this.scale * TILT, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private drawBumper(match: SumoMatch, index: number, now: number): void {
    const ctx = this.context;
    const p = this.palette;
    const bumper = match.world.rules.bumpers[index];
    if (!bumper) return;
    const flash = Math.max(0, 1 - (now - (this.bumperFlash.get(index) ?? -1e9)) / 300);
    const height = 26 + flash * 6;
    const [x, y] = this.project(bumper.x, bumper.y);
    const rx = BUMPER_RADIUS * this.scale * (1 + flash * 0.12);
    const ry = rx * TILT;
    const top = y - height * this.scale;
    ctx.fillStyle = shade(p.bumper, -0.35);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(x - rx, top);
    ctx.ellipse(x, top, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    // Sọc trắng quanh thân cột.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(x - rx, top + (y - top) * 0.45, rx * 2, (y - top) * 0.18);
    const cap = ctx.createRadialGradient(x - rx * 0.3, top - ry * 0.3, 0, x, top, rx);
    cap.addColorStop(0, '#ffffff');
    cap.addColorStop(0.4, p.bumper);
    cap.addColorStop(1, shade(p.bumper, -0.2));
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.ellipse(x, top, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    if (flash > 0) {
      ctx.globalAlpha = flash;
      ctx.strokeStyle = p.bumper;
      ctx.lineWidth = this.scale * 4;
      ctx.beginPath();
      ctx.ellipse(x, top, rx * (1.2 + (1 - flash)), ry * (1.2 + (1 - flash)), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /** Bóng, vòng hồi chiêu và vòng sáng "đây là bạn" dưới chân. */
  private drawFloorMarks(match: SumoMatch, fighter: Fighter): void {
    const ctx = this.context;
    const [x, y] = this.project(fighter.x, fighter.y);
    const rx = FIGHTER_RADIUS * this.scale * 1.05;
    const ry = rx * TILT;
    ctx.fillStyle = this.palette.shadow;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    const ready = 1 - Math.min(1, fighter.dashCooldown / DASH_COOLDOWN);
    ctx.lineWidth = Math.max(2, this.scale * 2.2);
    ctx.strokeStyle = fighter.color;
    ctx.globalAlpha = ready >= 1 ? 0.95 : 0.45;
    ctx.beginPath();
    ctx.ellipse(x, y, rx * 1.25, ry * 1.25, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ready);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const sinceTouch = match.world.time - fighter.touchedAt;
    if (sinceTouch < 1.4) {
      const t = (sinceTouch % 0.7) / 0.7;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.lineWidth = Math.max(2, this.scale * 2.5);
      ctx.beginPath();
      ctx.ellipse(x, y, rx * (1.3 + t * 1.2), ry * (1.3 + t * 1.2), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawFighter(match: SumoMatch, fighter: Fighter, now: number): void {
    const ctx = this.context;
    const p = this.palette;
    const ghost = fighter.status === 'ghost';
    const falling = fighter.status === 'falling';
    let radius = FIGHTER_RADIUS * this.scale * 1.12;
    let lift = 0;
    let alpha = 1;
    if (falling) {
      const t = 1 - Math.max(0, fighter.fallTimer / 0.75);
      lift = -t * t * 260;
      radius *= 1 - t * 0.45;
      alpha = 1 - t * 0.7;
    }
    if (ghost) {
      lift = 34 + Math.sin(now / 420 + fighter.key.length) * 6;
      alpha = 0.55;
    }
    const winner = match.phase !== 'fight' && match.phase !== 'countdown' && match.roundWinner === fighter.key && fighter.status === 'alive';
    if (winner) lift += Math.abs(Math.sin(now / 160)) * 16;

    const [x, floorY] = this.project(fighter.x, fighter.y, lift);
    const cy = floorY - radius * 0.92;

    // Méo hình: dẹt lại khi vừa va, kéo dài theo hướng lao.
    const speed = Math.hypot(fighter.vx, fighter.vy);
    const stretch = ghost ? 0 : Math.min(0.22, speed / 2_600) + (fighter.dash > 0 ? 0.08 : 0);
    const squash = fighter.impact < 0.25 ? Math.sin((fighter.impact / 0.25) * Math.PI) * 0.22 : 0;
    const angle = Math.atan2(fighter.vy * TILT, fighter.vx);
    const danger = match.danger(fighter);
    const wobble = danger > 0.5 && !ghost ? Math.sin(now / 45) * 0.08 * danger : 0;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, cy);
    ctx.rotate(wobble);
    ctx.save();
    ctx.rotate(angle);
    ctx.scale(1 + stretch, 1 - stretch * 0.6);
    ctx.rotate(-angle);
    ctx.scale(1 + squash, 1 - squash);

    if (fighter.dash > 0) {
      // Vệt gió phía sau khi húc.
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = this.scale * 2;
      const back = Math.atan2(-fighter.vy * TILT, -fighter.vx);
      for (let line = -1; line <= 1; line += 1) {
        const offset = line * radius * 0.45;
        const ox = Math.cos(back + Math.PI / 2) * offset;
        const oy = Math.sin(back + Math.PI / 2) * offset;
        ctx.beginPath();
        ctx.moveTo(ox + Math.cos(back) * radius * 1.05, oy + Math.sin(back) * radius * 1.05);
        ctx.lineTo(ox + Math.cos(back) * radius * 2.1, oy + Math.sin(back) * radius * 2.1);
        ctx.stroke();
      }
    }

    const body = ctx.createRadialGradient(-radius * 0.35, -radius * 0.45, radius * 0.1, 0, 0, radius);
    body.addColorStop(0, ghost ? '#ffffff' : mix(fighter.color, '#ffffff', 0.55));
    body.addColorStop(0.35, ghost ? mix(fighter.color, '#ffffff', 0.55) : fighter.color);
    body.addColorStop(1, ghost ? mix(fighter.color, '#ffffff', 0.2) : shade(fighter.color, -0.42));
    ctx.fillStyle = body;
    ctx.beginPath();
    if (ghost) {
      // Hồn ma: đuôi lượn sóng.
      ctx.arc(0, 0, radius, Math.PI, 0);
      const waves = 4;
      for (let index = 0; index <= waves; index += 1) {
        const wx = radius - (index / waves) * radius * 2;
        const wy = radius * 0.9 + Math.sin(now / 140 + index * 1.7) * radius * 0.16;
        ctx.lineTo(wx, wy);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
    }
    ctx.fill();

    if (!ghost) {
      // Đai mawashi và búi tóc chonmage.
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = shade(fighter.color, -0.6);
      ctx.fillRect(-radius, radius * 0.38, radius * 2, radius * 0.3);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-radius, radius * 0.38, radius * 2, radius * 0.06);
      ctx.restore();
      ctx.fillStyle = '#2a1420';
      ctx.beginPath();
      ctx.ellipse(0, -radius * 0.98, radius * 0.22, radius * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -radius * 1.12, radius * 0.12, radius * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    this.drawFace(fighter, radius, danger, winner, now);
    ctx.restore();
  }

  private drawFace(fighter: Fighter, radius: number, danger: number, winner: boolean, now: number): void {
    const ctx = this.context;
    const ghost = fighter.status === 'ghost';
    const lookX = Math.cos(fighter.facing);
    const lookY = Math.sin(fighter.facing) * TILT;
    const faceX = lookX * radius * 0.32;
    const faceY = -radius * 0.18 + lookY * radius * 0.3;
    const spread = radius * 0.3;
    const eyeR = radius * 0.2;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const ex = faceX + side * spread;
      const ey = faceY;
      if (fighter.stun > 0 && !ghost) {
        // Choáng: mắt xoắn ốc.
        ctx.strokeStyle = '#2a1420';
        ctx.lineWidth = Math.max(1.5, radius * 0.07);
        ctx.beginPath();
        for (let step = 0; step < 18; step += 1) {
          const a = step * 0.7 + now / 80;
          const r = (step / 18) * eyeR;
          if (step === 0) ctx.moveTo(ex + Math.cos(a) * r, ey + Math.sin(a) * r);
          else ctx.lineTo(ex + Math.cos(a) * r, ey + Math.sin(a) * r);
        }
        ctx.stroke();
        continue;
      }
      if (winner) {
        // Thắng: mắt cười ^ ^.
        ctx.strokeStyle = '#2a1420';
        ctx.lineWidth = Math.max(2, radius * 0.09);
        ctx.beginPath();
        ctx.moveTo(ex - eyeR, ey + eyeR * 0.3);
        ctx.lineTo(ex, ey - eyeR * 0.5);
        ctx.lineTo(ex + eyeR, ey + eyeR * 0.3);
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = ghost ? 'rgba(42,20,32,0.6)' : '#ffffff';
      ctx.beginPath();
      ctx.ellipse(ex, ey, eyeR, eyeR * (ghost ? 1.3 : 1.1), 0, 0, Math.PI * 2);
      ctx.fill();
      if (!ghost) {
        ctx.fillStyle = '#2a1420';
        ctx.beginPath();
        ctx.arc(ex + lookX * eyeR * 0.45, ey + lookY * eyeR * 0.6, eyeR * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ex + lookX * eyeR * 0.45 - eyeR * 0.2, ey + lookY * eyeR * 0.6 - eyeR * 0.2, eyeR * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      if (fighter.dash > 0 || fighter.dashBuffer) {
        // Lông mày quyết tâm khi húc.
        ctx.strokeStyle = '#2a1420';
        ctx.lineWidth = Math.max(2, radius * 0.08);
        ctx.beginPath();
        ctx.moveTo(ex - side * eyeR * 1.1, ey - eyeR * 1.6);
        ctx.lineTo(ex + side * eyeR * 0.9, ey - eyeR * 1.05);
        ctx.stroke();
      }
    }
    if (!ghost && !winner) {
      ctx.fillStyle = 'rgba(255,120,150,0.35)';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(faceX + side * spread * 1.6, faceY + eyeR * 1.4, eyeR * 0.7, eyeR * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (danger > 0.5 && !ghost) {
      // Sát mép: giọt mồ hôi.
      ctx.fillStyle = '#7fe7ff';
      const sx = radius * 0.78;
      const sy = -radius * 0.55 + Math.sin(now / 120) * radius * 0.05;
      ctx.beginPath();
      ctx.moveTo(sx, sy - radius * 0.28);
      ctx.quadraticCurveTo(sx + radius * 0.17, sy, sx, sy + radius * 0.08);
      ctx.quadraticCurveTo(sx - radius * 0.17, sy, sx, sy - radius * 0.28);
      ctx.fill();
    }
  }

  private drawNameTag(fighter: Fighter): void {
    const ctx = this.context;
    const radius = FIGHTER_RADIUS * this.scale * 1.12;
    const [x, floorY] = this.project(fighter.x, fighter.y);
    const y = floorY - radius * 2.35;
    const label = fighter.autopilot ? `${fighter.name} · TỰ ĐỘNG` : fighter.name;
    const size = Math.max(13, Math.min(22, radius * 0.42));
    ctx.font = `800 ${size}px ${FONT}`;
    const width = ctx.measureText(label).width + size * 1.1;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = fighter.color;
    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - size * 0.75, width, size * 1.45, size * 0.72);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - size * 0.3, y + size * 0.68);
    ctx.lineTo(x, y + size * 1.05);
    ctx.lineTo(x + size * 0.3, y + size * 0.68);
    ctx.fill();
    ctx.fillStyle = this.palette.tag;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + size * 0.02);
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  }

  private drawRings(now: number): void {
    const ctx = this.context;
    for (const ring of this.rings) {
      const t = (now - ring.born) / 600;
      const [x, y] = this.project(ring.x, ring.y);
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = this.scale * (5 - t * 3);
      ctx.beginPath();
      ctx.ellipse(x, y, ring.radius * this.scale * (0.4 + t * 0.6), ring.radius * this.scale * TILT * (0.4 + t * 0.6), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawParticles(now: number): void {
    const ctx = this.context;
    for (const particle of this.particles) {
      const age = (now - particle.born) / 1000;
      const life = particle.life / 1000;
      const gravity = particle.kind === 'confetti' ? 260 : particle.kind === 'spark' ? 0 : -20;
      const x = particle.x + particle.vx * age;
      const y = particle.y + particle.vy * age;
      const z = Math.max(0, particle.z + particle.vz * age - 0.5 * gravity * age * age);
      const [sx, sy] = this.project(x, y, z);
      ctx.globalAlpha = Math.max(0, 1 - age / life);
      ctx.fillStyle = particle.color;
      if (particle.kind === 'confetti') {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(age * 8 + particle.size);
        ctx.fillRect(-particle.size * this.scale, -particle.size * this.scale * 0.5, particle.size * this.scale * 2, particle.size * this.scale);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, particle.size * this.scale * (particle.kind === 'dust' ? 1 + age * 2 : 1 - age / life * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawFloaters(now: number): void {
    const ctx = this.context;
    ctx.textAlign = 'center';
    for (const floater of this.floaters) {
      const age = (now - floater.born) / 1000;
      const pop = age < 0.12 ? 0.6 + (age / 0.12) * 0.6 : 1.2 - Math.min(0.2, (age - 0.12) * 0.6);
      const [x, y] = this.project(floater.x, floater.y, 60 + age * 50);
      ctx.globalAlpha = Math.max(0, 1 - age * age);
      ctx.font = `800 ${Math.round(this.scale * 15 * floater.size * pop)}px ${FONT}`;
      ctx.lineWidth = this.scale * 2.5;
      ctx.strokeStyle = 'rgba(20,4,16,0.75)';
      ctx.strokeText(floater.text, x, y);
      ctx.fillStyle = floater.color;
      ctx.fillText(floater.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  private floater(x: number, y: number, text: string, color: string, now: number, size: number): void {
    this.floaters.push({ x, y, text, color, born: now, size });
  }

  private burst(x: number, y: number, count: number, color: string, speed: number, now: number, kind: 'dust' | 'spark'): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.4 + Math.random() * 0.7);
      this.particles.push({
        x, y, z: kind === 'spark' ? 24 : 4, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity,
        vz: kind === 'spark' ? (Math.random() - 0.3) * speed * 0.6 : 20, born: now,
        life: kind === 'spark' ? 280 + Math.random() * 220 : 380 + Math.random() * 260, color, size: kind === 'spark' ? 2.4 : 5,
        kind,
      });
    }
  }

  private confetti(x: number, y: number, color: string, now: number, count: number): void {
    const colors = [color, '#ffc23d', '#ffffff', '#7fe7ff', '#ff5caf'];
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 40 + Math.random() * 140;
      this.particles.push({
        x, y, z: 50, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, vz: 180 + Math.random() * 220,
        born: now, life: 1_400 + Math.random() * 700, color: colors[index % colors.length]!, size: 2.4 + Math.random() * 1.6, kind: 'confetti',
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
    // Chừa chỗ cho thanh trên, bảng người chơi phía dưới, thân sàn và tên trên đầu.
    const span = ARENA_RADIUS * 2 + 40;
    const width = Math.max(200, this.width - this.inset);
    const available = Math.max(200, this.height - TOP_MARGIN - BOTTOM_MARGIN);
    this.scale = Math.max(0.4, Math.min((width - 60) / span, available / (span * TILT + 70)));
    this.thickness = 34 * this.scale;
    this.cx = this.inset + width / 2;
    this.cy = TOP_MARGIN + 50 * this.scale + (available - this.thickness - 50 * this.scale) / 2;
  };
}

/** Làm tối/sáng màu hex theo tỉ lệ (-1..1). */
function shade(hex: string, amount: number): string {
  return amount < 0 ? mix(hex, '#000000', -amount) : mix(hex, '#ffffff', amount);
}

function mix(hex: string, other: string, amount: number): string {
  const a = Number.parseInt(hex.slice(1), 16);
  const b = Number.parseInt(other.slice(1), 16);
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
