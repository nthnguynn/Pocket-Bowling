const clamp = (value: number, min = -1, max = 1) => Math.max(min, Math.min(max, value));

interface PermissionedMotionEvent extends DeviceMotionEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export class MotionController {
  onSample?: (sample: { magnitude: number; spin: number; peak: number }) => void;
  onThrow?: (power: number, spin: number) => void;
  onStatus?: (message: string) => void;
  armed = false;
  private baselineGamma = 0;
  private gamma = 0;
  private smoothMagnitude = 0;
  private gestureStarted = 0;
  private lastMotionAt = 0;
  private lastSentAt = 0;
  private peak = 0;
  private impulse = 0;
  private spinSum = 0;
  private samples = 0;
  private cooldownUntil = 0;

  async enable(): Promise<boolean> {
    if (!('DeviceMotionEvent' in window)) {
      this.onStatus?.('Thiết bị không có cảm biến chuyển động — đã chuyển về cảm ứng.');
      return false;
    }
    const motionConstructor = DeviceMotionEvent as unknown as PermissionedMotionEvent;
    if (typeof motionConstructor.requestPermission === 'function') {
      const permission = await motionConstructor.requestPermission();
      if (permission !== 'granted') {
        this.onStatus?.('Chưa được cấp quyền cảm biến — hãy dùng chế độ cảm ứng.');
        return false;
      }
    }
    window.addEventListener('devicemotion', this.handleMotion);
    window.addEventListener('deviceorientation', this.handleOrientation);
    this.onStatus?.('Cảm biến sẵn sàng. Giữ chắc điện thoại, không buông tay khi vung.');
    return true;
  }

  disable(): void {
    this.armed = false;
    window.removeEventListener('devicemotion', this.handleMotion);
    window.removeEventListener('deviceorientation', this.handleOrientation);
  }

  calibrate(): void {
    this.baselineGamma = this.gamma;
    this.smoothMagnitude = 0;
    this.onStatus?.('Đã hiệu chỉnh tư thế hiện tại.');
  }

  setArmed(armed: boolean): void {
    this.armed = armed;
    this.resetGesture();
    this.onStatus?.(armed ? 'Đã sẵn sàng — vung nhẹ về phía trước, luôn giữ chắc máy.' : 'Đã hủy chuẩn bị.');
  }

  private readonly handleOrientation = (event: DeviceOrientationEvent): void => {
    this.gamma = event.gamma ?? 0;
  };

  private readonly handleMotion = (event: DeviceMotionEvent): void => {
    const now = performance.now();
    const acceleration = event.acceleration;
    if (!acceleration) return;
    const x = acceleration.x ?? 0;
    const y = acceleration.y ?? 0;
    const z = acceleration.z ?? 0;
    const rawMagnitude = Math.sqrt(x * x + y * y + z * z);
    this.smoothMagnitude = this.smoothMagnitude * 0.76 + rawMagnitude * 0.24;
    const rotation = event.rotationRate?.gamma ?? event.rotationRate?.beta ?? 0;
    const orientationSpin = clamp((this.gamma - this.baselineGamma) / 34);
    const rotationSpin = clamp(rotation / 145);
    const spin = clamp(orientationSpin * 0.42 + rotationSpin * 0.58);

    if (now - this.lastSentAt >= 34) {
      this.lastSentAt = now;
      this.onSample?.({ magnitude: this.smoothMagnitude, spin, peak: this.peak });
    }
    if (!this.armed || now < this.cooldownUntil) return;

    const dt = this.lastMotionAt ? Math.min(0.05, (now - this.lastMotionAt) / 1000) : 0;
    this.lastMotionAt = now;
    if (!this.gestureStarted && this.smoothMagnitude > 1.35) {
      this.gestureStarted = now;
      this.peak = this.smoothMagnitude;
      this.impulse = 0;
      this.spinSum = 0;
      this.samples = 0;
    }
    if (!this.gestureStarted) return;

    this.peak = Math.max(this.peak, this.smoothMagnitude);
    this.impulse += Math.max(0, this.smoothMagnitude - 0.45) * dt;
    this.spinSum += spin;
    this.samples += 1;
    const duration = now - this.gestureStarted;
    if ((duration > 150 && this.smoothMagnitude < 0.72) || duration > 850) {
      const power = clamp(0.24 + (this.peak - 1.1) / 6.2 + this.impulse / 4.6, 0.25, 1);
      const finalSpin = clamp(this.samples ? this.spinSum / this.samples : 0);
      this.armed = false;
      this.cooldownUntil = now + 1_400;
      this.onThrow?.(power, finalSpin);
      this.onStatus?.(`Đã nhận cú vung: lực ${Math.round(power * 100)}%, xoáy ${Math.round(finalSpin * 100)}%.`);
      this.resetGesture();
    }
  };

  private resetGesture(): void {
    this.gestureStarted = 0;
    this.lastMotionAt = 0;
    this.peak = 0;
    this.impulse = 0;
    this.spinSum = 0;
    this.samples = 0;
  }
}
