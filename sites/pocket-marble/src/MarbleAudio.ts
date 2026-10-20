import type { MarbleEvent } from './physics';

/** Âm thanh tổng hợp bằng Web Audio, giống cách AudioEngine của bowling làm. */
export class MarbleAudio {
  muted = false;
  private context: AudioContext | null = null;

  toggle(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  event(type: MarbleEvent): void {
    if (type === 'gem') this.tone(1320, 0.12, 'triangle', 0.05, 1760);
    if (type === 'jump') this.tone(320, 0.18, 'sine', 0.05, 640);
    if (type === 'fall') this.tone(520, 0.55, 'sawtooth', 0.035, 70);
    if (type === 'bump') this.tone(120, 0.14, 'triangle', 0.09, 60);
    if (type === 'boost') this.tone(400, 0.3, 'sawtooth', 0.03, 1000);
    if (type === 'drop') this.tone(260, 0.35, 'square', 0.03, 130);
    if (type === 'out') [440, 330, 220].forEach((frequency, index) => this.tone(frequency, 0.22, 'sawtooth', 0.04, frequency * 0.9, index * 0.16));
    if (type === 'finish') [660, 880, 1100, 1320].forEach((frequency, index) => this.tone(frequency, 0.16, 'triangle', 0.05, frequency, index * 0.09));
  }

  countdown(go: boolean): void {
    this.tone(go ? 880 : 440, go ? 0.35 : 0.14, 'square', 0.04);
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number, slideTo = frequency, delay = 0): void {
    if (this.muted) return;
    try {
      this.context ??= new AudioContext();
      const context = this.context;
      if (context.state === 'suspended') void context.resume();
      const start = context.currentTime + delay;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      if (slideTo !== frequency) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    } catch {
      // Trình duyệt chặn âm thanh khi chưa có thao tác người dùng; game vẫn chơi bình thường.
    }
  }
}
