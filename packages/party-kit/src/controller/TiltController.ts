interface PermissionedOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/** Góc nghiêng (độ) tương ứng với lái hết cỡ. */
const FULL_TILT_DEGREES = 28;
const DEADZONE = 0.05;

/**
 * Đọc độ nghiêng trái/phải của điện thoại (như nghiêng tấm bìa trong Give Me Toilet Paper!).
 * Tự đổi trục theo hướng màn hình; lần đầu có dữ liệu thì lấy tư thế hiện tại làm "phẳng".
 */
export class TiltController {
  /** -1 (trái) .. 1 (phải), đã lọc. */
  value = 0;
  enabled = false;
  onStatus?: (message: string) => void;
  private neutral: number | null = null;
  private raw = 0;

  static supported(): boolean {
    return 'DeviceOrientationEvent' in window && window.isSecureContext;
  }

  async enable(): Promise<boolean> {
    if (!('DeviceOrientationEvent' in window)) {
      this.onStatus?.('Thiết bị không có cảm biến nghiêng — dùng nút bấm nhé.');
      return false;
    }
    if (!window.isSecureContext) {
      this.onStatus?.('Cảm biến nghiêng cần HTTPS (xem README). Tạm thời dùng nút bấm.');
      return false;
    }
    const orientation = DeviceOrientationEvent as unknown as PermissionedOrientationEvent;
    if (typeof orientation.requestPermission === 'function') {
      try {
        if (await orientation.requestPermission() !== 'granted') {
          this.onStatus?.('Chưa được cấp quyền cảm biến — dùng nút bấm nhé.');
          return false;
        }
      } catch {
        this.onStatus?.('Trình duyệt từ chối quyền cảm biến — dùng nút bấm nhé.');
        return false;
      }
    }
    window.addEventListener('deviceorientation', this.handle);
    this.enabled = true;
    this.neutral = null;
    this.onStatus?.('Đã bật nghiêng. Cầm máy như cầm khay, nghiêng trái/phải để lái.');
    return true;
  }

  disable(): void {
    window.removeEventListener('deviceorientation', this.handle);
    this.enabled = false;
    this.value = 0;
  }

  calibrate(): void {
    this.neutral = this.raw;
    this.value = 0;
    this.onStatus?.('Đã lấy tư thế hiện tại làm mặt phẳng.');
  }

  private readonly handle = (event: DeviceOrientationEvent): void => {
    const angle = screen.orientation?.angle ?? 0;
    const reading = angle === 90 ? event.beta : angle === 270 ? -(event.beta ?? 0) : angle === 180 ? -(event.gamma ?? 0) : event.gamma;
    if (reading === null || reading === undefined || !Number.isFinite(reading)) return;
    this.raw = reading;
    this.neutral ??= reading;
    let tilt = Math.max(-1, Math.min(1, (reading - this.neutral) / FULL_TILT_DEGREES));
    tilt = Math.abs(tilt) < DEADZONE ? 0 : (tilt - Math.sign(tilt) * DEADZONE) / (1 - DEADZONE);
    this.value += (tilt - this.value) * 0.35;
  };
}
