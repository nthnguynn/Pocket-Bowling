import type { MatchEvent } from './RollMatch';

/** Âm thanh tổng hợp bằng Web Audio như các game khác, thêm tiếng xé giấy (nhiễu) khi chạm cưa. */
export class RollAudio {
  muted = false;
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  toggle(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  event({ event }: MatchEvent): void {
    switch (event.type) {
      case 'jump': this.tone(380, 0.16, 'sine', 0.05, 720); break;
      case 'land': this.tone(140, 0.1, 'triangle', 0.04 + event.strength * 0.05, 70); break;
      case 'bounce': this.tone(300, 0.32, 'sine', 0.08, 900); break;
      case 'bump': this.tone(220, 0.08, 'triangle', 0.05, 160); break;
      case 'die':
        if (event.cause === 'saw') this.rip(0.45, 0.12);
        else if (event.cause === 'water') this.rip(0.4, 0.07, 400);
        else this.tone(800, 0.6, 'sine', 0.05, 110);
        break;
      case 'respawn': this.tone(520, 0.12, 'triangle', 0.04, 780); break;
      case 'checkpoint': [784, 1047].forEach((frequency, index) => this.tone(frequency, 0.14, 'triangle', 0.05, frequency, index * 0.09)); break;
      case 'goal': [523, 659, 784, 1047].forEach((frequency, index) => this.tone(frequency, 0.18, 'triangle', 0.055, frequency, index * 0.09)); break;
      case 'tick': this.tone(440, 0.14, 'square', 0.04); break;
      case 'go': this.tone(880, 0.35, 'square', 0.045); break;
      case 'levelEnd': this.tone(event.cleared ? 660 : 220, 0.4, 'triangle', 0.05, event.cleared ? 990 : 160); break;
      case 'matchEnd': [523, 659, 784, 1047, 1319].forEach((frequency, index) => this.tone(frequency, 0.22, 'triangle', 0.055, frequency, index * 0.11)); break;
    }
  }

  private audio(): AudioContext | null {
    if (this.muted) return null;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume();
      return this.context;
    } catch {
      // Trình duyệt chặn âm thanh khi chưa có thao tác người dùng; game vẫn chơi bình thường.
      return null;
    }
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number, slideTo = frequency, delay = 0): void {
    const context = this.audio();
    if (!context) return;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (slideTo !== frequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  /** Tiếng xé giấy / té nước: nhiễu trắng qua bộ lọc thông cao. */
  private rip(duration: number, volume: number, cutoff = 1_800): void {
    const context = this.audio();
    if (!context) return;
    if (!this.noise) {
      this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    }
    const start = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = cutoff;
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(start);
    source.stop(start + duration + 0.02);
  }
}
