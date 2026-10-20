export class AudioEngine {
  muted = false;
  private context: AudioContext | null = null;

  toggle(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  roll(): void {
    if (this.muted) return;
    const context = this.ensureContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(82, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(48, context.currentTime + 0.8);
    gain.gain.setValueAtTime(0.045, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.9);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.9);
  }

  impact(intensity = 1): void {
    if (this.muted) return;
    const context = this.ensureContext();
    const strength = Math.max(0.35, Math.min(1, intensity));
    const oscillator = context.createOscillator();
    const oscillatorGain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(155, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(58, context.currentTime + 0.16);
    oscillatorGain.gain.setValueAtTime(0.12 * strength, context.currentTime);
    oscillatorGain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
    oscillator.connect(oscillatorGain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.22);
  }

  gutter(): void {
    if (this.muted) return;
    const context = this.ensureContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(94, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(52, context.currentTime + 0.28);
    gain.gain.setValueAtTime(0.07, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.34);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.36);
  }

  pins(count: number): void {
    if (this.muted || count <= 0) return;
    const context = this.ensureContext();
    const duration = Math.min(0.75, 0.24 + count * 0.045);
    const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      const decay = 1 - index / data.length;
      data[index] = (Math.random() * 2 - 1) * decay * decay;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = 430;
    filter.Q.value = 0.65;
    gain.gain.value = Math.min(0.22, 0.06 + count * 0.016);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
  }

  cheer(): void {
    if (this.muted) return;
    const context = this.ensureContext();
    [392, 523, 659].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.075;
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.08, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    });
  }

  private ensureContext(): AudioContext {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }
}
