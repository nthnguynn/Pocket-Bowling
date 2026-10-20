/** Bán kính vòng gốc của cần điều khiển (px CSS). */
const BASE_RADIUS = 66;
const KNOB_RADIUS = 34;
const DEADZONE = 0.12;
/** Vuốt nhanh hơn ngần này (px/ms) rồi thả tay là húc. */
const FLICK_SPEED = 0.75;
const FLICK_MIN_DISTANCE = 26;
const FLICK_WINDOW_MS = 90;

export type PadMode = 'fighter' | 'ghost' | 'idle';

interface Sample { x: number; y: number; t: number }
interface Ripple { x: number; y: number; born: number; dx: number; dy: number }

/**
 * Vùng điều khiển toàn màn hình trên điện thoại, không cần nhìn xuống máy:
 * đặt ngón cái ở đâu thì cần điều khiển hiện ở đó (kéo quá xa thì vòng gốc chạy theo),
 * vuốt nhanh rồi thả để húc, hoặc chạm thêm ngón thứ hai để húc theo hướng đang chạy.
 */
export class JoystickPad {
  /** -1..1, y dương là hướng xuống màn hình (khớp hướng xuống trên TV). */
  value = { x: 0, y: 0 };
  touching = false;
  mode: PadMode = 'idle';
  color = '#ff78bd';
  /** 0..1 phần hồi chiêu còn lại, để vẽ vòng quanh cần. */
  cooldown = 0;
  /** 0..1 mức nguy hiểm (sát mép) do TV báo về. */
  danger = 0;
  onDash?: (x: number, y: number) => void;
  onTouchStart?: () => void;
  readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private primary: number | null = null;
  private base = { x: 0, y: 0 };
  private knob = { x: 0, y: 0 };
  private samples: Sample[] = [];
  private ripples: Ripple[] = [];
  private lastDirection = { x: 0, y: -1 };
  private width = 1;
  private height = 1;
  private frameId = 0;

  constructor(private readonly element: HTMLElement) {
    this.canvas.className = 'pad-canvas';
    element.prepend(this.canvas);
    this.context = this.canvas.getContext('2d')!;
    element.addEventListener('pointerdown', this.down);
    element.addEventListener('pointermove', this.move);
    element.addEventListener('pointerup', this.up);
    element.addEventListener('pointercancel', this.cancel);
    element.addEventListener('contextmenu', (event) => event.preventDefault());
    new ResizeObserver(() => this.resize()).observe(element);
    this.resize();
    this.frameId = requestAnimationFrame(this.draw);
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
  }

  /** Thả cần ngay (ví dụ khi ván kết thúc) để không gửi hướng cũ. */
  release(): void {
    this.primary = null;
    this.touching = false;
    this.value = { x: 0, y: 0 };
    this.samples = [];
  }

  private readonly down = (event: PointerEvent): void => {
    event.preventDefault();
    const point = this.point(event);
    if (this.primary !== null && event.pointerId !== this.primary) {
      // Ngón thứ hai: húc theo hướng đang chạy.
      const direction = Math.hypot(this.value.x, this.value.y) > 0.2 ? this.value : this.lastDirection;
      this.fireDash(direction.x, direction.y, point.x, point.y);
      return;
    }
    this.element.setPointerCapture(event.pointerId);
    this.primary = event.pointerId;
    this.touching = true;
    this.base = { ...point };
    this.knob = { ...point };
    this.samples = [{ ...point, t: event.timeStamp }];
    this.value = { x: 0, y: 0 };
    this.onTouchStart?.();
  };

  private readonly move = (event: PointerEvent): void => {
    if (event.pointerId !== this.primary) return;
    const point = this.point(event);
    this.knob = point;
    let dx = point.x - this.base.x;
    let dy = point.y - this.base.y;
    const distance = Math.hypot(dx, dy);
    if (distance > BASE_RADIUS) {
      // Cần nổi: kéo quá vòng thì vòng gốc trượt theo, không bao giờ phải nhấc tay đặt lại.
      this.base.x = point.x - (dx / distance) * BASE_RADIUS;
      this.base.y = point.y - (dy / distance) * BASE_RADIUS;
      dx = point.x - this.base.x;
      dy = point.y - this.base.y;
    }
    const magnitude = Math.min(1, Math.hypot(dx, dy) / BASE_RADIUS);
    if (magnitude < DEADZONE) {
      this.value = { x: 0, y: 0 };
    } else {
      const scaled = (magnitude - DEADZONE) / (1 - DEADZONE);
      const length = Math.hypot(dx, dy);
      this.value = { x: (dx / length) * scaled, y: (dy / length) * scaled };
      this.lastDirection = { x: dx / length, y: dy / length };
    }
    this.samples.push({ ...point, t: event.timeStamp });
    this.samples = this.samples.filter((sample) => event.timeStamp - sample.t < 160);
  };

  private readonly up = (event: PointerEvent): void => {
    if (event.pointerId !== this.primary) return;
    const point = this.point(event);
    this.samples.push({ ...point, t: event.timeStamp });
    const flick = this.flick(event.timeStamp);
    this.release();
    if (flick) this.fireDash(flick.x, flick.y, point.x, point.y);
  };

  private readonly cancel = (event: PointerEvent): void => {
    if (event.pointerId === this.primary) this.release();
  };

  /** Hướng vuốt nếu ngón tay rời màn hình khi đang lướt nhanh. */
  private flick(now: number): { x: number; y: number } | null {
    const recent = this.samples.filter((sample) => now - sample.t <= FLICK_WINDOW_MS);
    const first = recent[0];
    const last = recent.at(-1);
    if (!first || !last || last.t - first.t < 8) return null;
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const distance = Math.hypot(dx, dy);
    if (distance < FLICK_MIN_DISTANCE || distance / (last.t - first.t) < FLICK_SPEED) return null;
    return { x: dx / distance, y: dy / distance };
  }

  private fireDash(x: number, y: number, atX: number, atY: number): void {
    if (this.mode === 'idle') return;
    this.lastDirection = { x, y };
    this.ripples.push({ x: atX, y: atY, born: performance.now(), dx: x, dy: y });
    this.onDash?.(x, y);
  }

  private point(event: PointerEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private resize(): void {
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    this.width = Math.max(1, this.element.clientWidth);
    this.height = Math.max(1, this.element.clientHeight);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private readonly draw = (now: number): void => {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);
    const ghost = this.mode === 'ghost';
    const color = ghost ? '#ffffff' : this.color;

    // Lưới chấm mờ cho cảm giác "mặt sàn" có thể chạm vào.
    ctx.fillStyle = withAlpha(color, 0.12);
    const gap = 28;
    for (let y = gap / 2; y < this.height; y += gap) {
      for (let x = gap / 2; x < this.width; x += gap) {
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (this.danger > 0.4) {
      // Sát mép: viền đỏ đập theo nhịp.
      const pulse = 0.5 + 0.5 * Math.sin(now / 110);
      ctx.strokeStyle = `rgba(255,77,94,${(0.35 + pulse * 0.45) * this.danger})`;
      ctx.lineWidth = 10 + pulse * 8;
      ctx.strokeRect(0, 0, this.width, this.height);
    }

    this.ripples = this.ripples.filter((ripple) => now - ripple.born < 450);
    for (const ripple of this.ripples) {
      const t = (now - ripple.born) / 450;
      ctx.strokeStyle = withAlpha(color, 1 - t);
      ctx.lineWidth = 6 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, 30 + t * 110, 0, Math.PI * 2);
      ctx.stroke();
      // Mũi tên hướng húc.
      ctx.fillStyle = withAlpha(color, 1 - t);
      const tipX = ripple.x + ripple.dx * (60 + t * 90);
      const tipY = ripple.y + ripple.dy * (60 + t * 90);
      const angle = Math.atan2(ripple.dy, ripple.dx);
      ctx.beginPath();
      ctx.moveTo(tipX + Math.cos(angle) * 22, tipY + Math.sin(angle) * 22);
      ctx.lineTo(tipX + Math.cos(angle + 2.5) * 18, tipY + Math.sin(angle + 2.5) * 18);
      ctx.lineTo(tipX + Math.cos(angle - 2.5) * 18, tipY + Math.sin(angle - 2.5) * 18);
      ctx.fill();
    }

    if (this.touching) {
      const { base, knob } = this;
      const dx = knob.x - base.x;
      const dy = knob.y - base.y;
      const length = Math.min(BASE_RADIUS, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      const kx = base.x + Math.cos(angle) * length;
      const ky = base.y + Math.sin(angle) * length;
      ctx.fillStyle = withAlpha(color, 0.12);
      ctx.strokeStyle = withAlpha(color, 0.5);
      ctx.lineWidth = 2;
      if (ghost) ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(base.x, base.y, BASE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      // Vòng hồi chiêu: đầy là húc được.
      const ready = 1 - this.cooldown;
      ctx.strokeStyle = ready >= 1 ? color : withAlpha(color, 0.45);
      ctx.lineWidth = ready >= 1 ? 7 : 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(base.x, base.y, BASE_RADIUS + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ready);
      ctx.stroke();
      ctx.lineCap = 'butt';
      const knobGradient = ctx.createRadialGradient(kx - 10, ky - 12, 4, kx, ky, KNOB_RADIUS);
      knobGradient.addColorStop(0, '#ffffff');
      knobGradient.addColorStop(0.35, color);
      knobGradient.addColorStop(1, withAlpha(color, 0.75));
      ctx.fillStyle = knobGradient;
      ctx.shadowColor = withAlpha(color, 0.6);
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.arc(kx, ky, KNOB_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (this.mode !== 'idle') {
      // Gợi ý: một vòng thở nhẹ ở giữa vùng chạm.
      const breathe = 0.5 + 0.5 * Math.sin(now / 600);
      ctx.strokeStyle = withAlpha(color, 0.18 + breathe * 0.2);
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.arc(this.width / 2, this.height * 0.58, BASE_RADIUS + breathe * 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    this.frameId = requestAnimationFrame(this.draw);
  };
}

/** Thêm alpha cho màu hex #rrggbb (màu người chơi luôn ở dạng này). */
function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}
