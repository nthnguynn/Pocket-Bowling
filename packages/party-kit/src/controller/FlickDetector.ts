interface Vector { x: number; y: number; z: number }

interface PermissionedMotionEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/** Gia tốc hướng lên (m/s², đã bỏ trọng lực) tính là một cú hất. */
const DEFAULT_THRESHOLD = 9;
const COOLDOWN_MS = 450;
/** Sau một cú hất, gia tốc phải tụt dưới mức này mới nhận cú tiếp theo (tránh một cú bị đếm hai lần). */
const REARM_RATIO = 0.35;
/** Không nhận dữ liệu gia tốc trong ngần này thì coi như máy không hỗ trợ. */
const SILENT_MS = 1_500;

const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vector) => Math.hypot(a.x, a.y, a.z);

/**
 * Nhận diện cú hất điện thoại lên (như giật tấm bìa lên trong Give Me Toilet Paper!).
 * Chỉ xét phần gia tốc theo hướng ngược trọng lực, nên cầm máy nằm ngang hay dựng đứng đều được,
 * còn nghiêng/lắc ngang để lái không bị tính là nhảy. Không phụ thuộc quy ước dấu của từng trình duyệt
 * vì gia tốc và trọng lực luôn được đo cùng một quy ước rồi mới nhân vô hướng.
 */
export class FlickDetector {
  onFlick?: () => void;
  threshold = DEFAULT_THRESHOLD;
  private gravity: Vector | null = null;
  private lastFlickAt = -Infinity;
  private lastSampleAt = -Infinity;
  private armed = true;
  private listening = false;

  /** iPhone cần thao tác của người dùng mới hỏi quyền; gọi trong sự kiện chạm/bấm. */
  static async requestPermission(): Promise<boolean> {
    if (!('DeviceMotionEvent' in window) || !window.isSecureContext) return false;
    const motion = DeviceMotionEvent as unknown as PermissionedMotionEvent;
    if (typeof motion.requestPermission !== 'function') return true;
    try {
      return await motion.requestPermission() === 'granted';
    } catch {
      return false;
    }
  }

  get active(): boolean {
    return this.listening;
  }

  /** Đang thực sự nhận dữ liệu gia tốc (có máy bật được sự kiện nhưng không bao giờ gửi dữ liệu). */
  get receiving(): boolean {
    return this.listening && performance.now() - this.lastSampleAt < SILENT_MS;
  }

  start(): void {
    if (this.listening) return;
    this.listening = true;
    this.gravity = null;
    this.armed = true;
    window.addEventListener('devicemotion', this.handle);
  }

  stop(): void {
    this.listening = false;
    window.removeEventListener('devicemotion', this.handle);
  }

  /**
   * Một mẫu cảm biến. `withGravity` là accelerationIncludingGravity; `linear` là acceleration
   * (đã bỏ trọng lực) nếu trình duyệt có, nếu không thì tự tách trọng lực bằng bộ lọc thông thấp.
   * Trả về true nếu mẫu này là một cú hất.
   */
  push(withGravity: Vector, linear: Vector | null, time: number): boolean {
    this.lastSampleAt = time;
    const gravitySample = linear
      ? { x: withGravity.x - linear.x, y: withGravity.y - linear.y, z: withGravity.z - linear.z }
      : withGravity;
    if (!this.gravity) {
      this.gravity = { ...gravitySample };
      if (!linear) return false;
    } else {
      const k = linear ? 0.3 : 0.06;
      this.gravity = {
        x: this.gravity.x + (gravitySample.x - this.gravity.x) * k,
        y: this.gravity.y + (gravitySample.y - this.gravity.y) * k,
        z: this.gravity.z + (gravitySample.z - this.gravity.z) * k,
      };
    }
    const gravityLength = length(this.gravity);
    // Đang rơi tự do hoặc dữ liệu lỗi: không xác định được đâu là "lên".
    if (gravityLength < 4) return false;
    const acceleration = linear ?? {
      x: withGravity.x - this.gravity.x,
      y: withGravity.y - this.gravity.y,
      z: withGravity.z - this.gravity.z,
    };
    const upward = dot(acceleration, this.gravity) / gravityLength;
    if (!this.armed) {
      if (upward < this.threshold * REARM_RATIO) this.armed = true;
      return false;
    }
    if (upward < this.threshold || time - this.lastFlickAt < COOLDOWN_MS) return false;
    this.lastFlickAt = time;
    this.armed = false;
    this.onFlick?.();
    return true;
  }

  private readonly handle = (event: DeviceMotionEvent): void => {
    const g = event.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null || g.z === null) return;
    const a = event.acceleration;
    const linear = a && a.x !== null && a.y !== null && a.z !== null ? { x: a.x, y: a.y, z: a.z } : null;
    this.push({ x: g.x, y: g.y, z: g.z }, linear, performance.now());
  };
}
