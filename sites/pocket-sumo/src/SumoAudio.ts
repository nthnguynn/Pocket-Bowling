import type { MatchEvent } from './SumoMatch';

/** Âm thanh tổng hợp bằng Web Audio như MarbleAudio, thêm tiếng gió (nhiễu lọc) cho cú húc và sàn sụp. */
export class SumoAudio {
  muted = false;
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  toggle(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  event(event: MatchEvent): void {
    switch (event.type) {
      case 'dash': this.whoosh(0.18, 900, 2_400, 0.07); break;
      case 'bump':
        this.tone(170 - event.strength * 70, 0.16, 'triangle', 0.06 + event.strength * 0.08, 55);
        if (event.strength > 0.7) this.whoosh(0.12, 400, 200, 0.06);
        break;
      case 'clash': this.tone(1_400, 0.25, 'square', 0.03, 900); this.tone(110, 0.2, 'triangle', 0.12, 50); break;
      case 'bumper': this.tone(260, 0.3, 'sine', 0.09, 720); break;
      case 'fall': this.tone(900, 0.75, 'sine', 0.05, 120); break;
      case 'puff': this.whoosh(0.35, 300, 1_200, 0.05); break;
      case 'warn': [0, 0.22, 0.44].forEach((delay) => this.tone(560, 0.12, 'square', 0.03, 560, delay)); break;
      case 'crumble': this.whoosh(0.9, 180, 60, 0.12); this.tone(70, 0.8, 'sawtooth', 0.05, 35); break;
      case 'spawn': this.tone(520, 0.12, 'triangle', 0.04, 880); break;
      case 'tick': this.tone(440, 0.14, 'square', 0.04); break;
      case 'go': this.tone(880, 0.35, 'square', 0.045); this.whoosh(0.3, 600, 1_800, 0.05); break;
      case 'roundEnd': [523, 659, 784].forEach((frequency, index) => this.tone(frequency, 0.18, 'triangle', 0.05, frequency, index * 0.1)); break;
      case 'matchEnd': [523, 659, 784, 1_047, 1_319].forEach((frequency, index) => this.tone(frequency, 0.22, 'triangle', 0.055, frequency, index * 0.11)); break;
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

  /** Tiếng gió: nhiễu trắng qua bộ lọc band-pass quét tần số. */
  private whoosh(duration: number, from: number, to: number, volume: number): void {
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
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + duration * 0.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(start);
    source.stop(start + duration + 0.02);
  }
}
