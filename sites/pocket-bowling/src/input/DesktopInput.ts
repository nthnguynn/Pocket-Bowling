import type { ThrowInput } from '../types';

export interface DesktopControls {
  position: number;
  aim: number;
  power: number;
  spin: number;
}

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

export class DesktopInput {
  controls: DesktopControls = { position: 0, aim: 0, power: 0.68, spin: 0 };
  onChange?: (controls: DesktopControls) => void;
  onPrepare?: () => boolean;
  onCancel?: () => void;
  onThrow?: (id: string, input: ThrowInput) => boolean;
  onCharge?: (value: number, active: boolean) => void;
  private charging = false;
  private chargeStarted = 0;
  private frame = 0;

  start(): void {
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    this.frame = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    cancelAnimationFrame(this.frame);
  }

  setControl(name: keyof DesktopControls, value: number): void {
    this.controls[name] = name === 'power' ? Math.max(0.2, Math.min(1, value)) : clamp(value);
    this.onChange?.({ ...this.controls });
  }

  startCharge(): void {
    if (this.charging || this.onPrepare?.() === false) return;
    this.charging = true;
    this.chargeStarted = performance.now();
    this.onCharge?.(this.controls.power, true);
  }

  releaseCharge(): void {
    if (!this.charging) return;
    this.charging = false;
    const id = `desktop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const accepted = this.onThrow?.(id, { ...this.controls, source: 'desktop' }) ?? false;
    this.onCharge?.(this.controls.power, false);
    if (!accepted) this.onCancel?.();
  }

  cancelCharge(): void {
    if (!this.charging) return;
    this.charging = false;
    this.onCancel?.();
    this.onCharge?.(this.controls.power, false);
  }

  private readonly keyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) this.startCharge();
      return;
    }
    const delta = event.shiftKey ? 0.12 : 0.055;
    const updates: Partial<DesktopControls> = {};
    if (event.code === 'KeyA') updates.position = clamp(this.controls.position - delta);
    if (event.code === 'KeyD') updates.position = clamp(this.controls.position + delta);
    if (event.code === 'KeyQ') updates.aim = clamp(this.controls.aim - delta);
    if (event.code === 'KeyE') updates.aim = clamp(this.controls.aim + delta);
    if (event.code === 'KeyZ') updates.spin = clamp(this.controls.spin - delta);
    if (event.code === 'KeyC') updates.spin = clamp(this.controls.spin + delta);
    if (event.code === 'KeyW') updates.power = Math.min(1, this.controls.power + delta);
    if (event.code === 'KeyS') updates.power = Math.max(0.2, this.controls.power - delta);
    if (Object.keys(updates).length) {
      event.preventDefault();
      this.controls = { ...this.controls, ...updates };
      this.onChange?.({ ...this.controls });
    }
  };

  private readonly keyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') {
      event.preventDefault();
      this.releaseCharge();
    }
  };

  private readonly tick = (): void => {
    if (this.charging) {
      const elapsed = (performance.now() - this.chargeStarted) / 1000;
      const triangle = 1 - Math.abs(((elapsed * 0.72) % 2) - 1);
      this.controls.power = 0.25 + triangle * 0.75;
      this.onChange?.({ ...this.controls });
      this.onCharge?.(this.controls.power, true);
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}
