import { WebRTCController } from '../network/WebRTCController';
import type { PartyStage } from '../types';
import { PhoneSeat } from './PhoneSeat';
import { bindThemeToggle } from './theme';

const CLIENT_KEY = 'pocket-client-id';

/** Danh tính theo từng tab: tải lại trang vẫn giữ ghế, mở tab khác là người chơi khác. Không cần tài khoản. */
export function tabClientId(): string {
  try {
    const saved = sessionStorage.getItem(CLIENT_KEY);
    if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
  } catch {
    // Storage có thể bị chặn (chế độ riêng tư); khi đó chỉ mất khả năng nhận lại ghế.
  }
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  try {
    sessionStorage.setItem(CLIENT_KEY, id);
  } catch {
    // Như trên.
  }
  return id;
}

/**
 * Phần chung của mọi trang tay cầm: nhập/quét mã phòng, trạng thái kết nối, gửi hello,
 * tự nối lại đúng ghế khi mở khóa màn hình và giữ màn hình sáng khi đang chơi.
 */
export class PhoneConnection {
  readonly network = new WebRTCController();
  readonly seat: PhoneSeat;
  readonly clientId = tabClientId();
  connected = false;
  onDispose?: () => void;
  private room = '';
  private everConnected = false;
  private wakeLock: WakeLockSentinel | null = null;

  /** `shell` là phần tử gốc của trang (có data-phone-shell). */
  constructor(private readonly shell: HTMLElement) {
    this.seat = new PhoneSeat(shell);
  }

  static headerHtml(subtitle: string, icon = '<div class="brand-ball"><i></i><i></i><i></i></div>'): string {
    return `<header class="phone-header"><div class="brand-lockup small">${icon}<div><strong>POCKET</strong><span>${subtitle}</span></div></div><div class="phone-header-actions"><button class="theme-toggle theme-toggle--compact" data-theme-toggle type="button"><span data-theme-icon aria-hidden="true">☀</span><span class="sr-only" data-theme-label>Chế độ sáng</span></button><div class="phone-status"><i data-controller-dot></i><span data-controller-status>chưa kết nối</span></div></div></header>
      <section class="join-card" data-join-card><label><span>MÃ PHÒNG</span><input data-room-input inputmode="text" maxlength="11" placeholder="ABCDE-FGHJK" autocomplete="off"></label><button data-connect>KẾT NỐI</button></section>
      ${PhoneSeat.html()}`;
  }

  start(): void {
    bindThemeToggle(this.shell);
    this.seat.bind();
    this.seat.onName = () => this.sendHello();
    this.seat.onStart = () => {
      this.network.sendCommand({ type: 'lobby', action: 'start', seq: sequence('start') });
    };
    this.network.onState = (state, detail) => {
      this.query('[data-controller-status]').textContent = detail ? `${state} · ${detail}` : state;
      this.connected = this.network.isOpen;
      if (this.connected) this.everConnected = true;
      this.query('[data-controller-dot]').classList.toggle('is-online', this.connected);
      this.shell.classList.toggle('is-connected', this.connected);
      if (!this.connected) this.setStage('offline');
      if (this.connected) void this.requestWakeLock();
    };
    this.network.onOpen = () => this.sendHello();
    this.network.onNotice = (message) => {
      const feedback = this.shell.querySelector('[data-feedback]');
      if (feedback) feedback.textContent = message;
    };
    this.query<HTMLButtonElement>('[data-connect]').addEventListener('click', () => {
      void this.requestWakeLock();
      void this.connect(this.query<HTMLInputElement>('[data-room-input]').value);
    });

    const room = new URLSearchParams(location.search).get('room');
    if (room) {
      this.query<HTMLInputElement>('[data-room-input]').value = room;
      void this.connect(room);
    }
    window.addEventListener('pagehide', () => this.dispose(), { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (this.connected) void this.requestWakeLock();
      // Điện thoại khóa màn hình thường làm rớt kết nối; mở lại thì tự vào lại đúng ghế.
      else if (this.everConnected && this.room) void this.connect(this.room);
    });
  }

  setStage(stage: 'offline' | PartyStage): void {
    this.shell.dataset.stage = stage;
  }

  sendLobby(action: 'start' | 'restart'): void {
    this.network.sendCommand({ type: 'lobby', action, seq: sequence(action) });
  }

  async requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => { this.wakeLock = null; }, { once: true });
    } catch {
      // Wake Lock is a progressive enhancement; gameplay remains fully usable.
    }
  }

  private async connect(rawRoom: string): Promise<void> {
    this.room = rawRoom.toUpperCase().replace(/[^A-Z2-9]/g, '');
    if (this.room.length !== 10) {
      this.query('[data-controller-status]').textContent = 'Mã phòng cần đủ 10 ký tự.';
      return;
    }
    this.query('[data-join-card]').classList.add('is-joining');
    try {
      await this.network.connect(this.room, this.clientId);
    } catch (error) {
      this.query('[data-controller-status]').textContent = error instanceof Error ? error.message : String(error);
    }
  }

  private sendHello(): void {
    this.network.sendCommand({ type: 'hello', clientId: this.clientId, name: this.seat.name });
  }

  private dispose(): void {
    this.onDispose?.();
    this.network.dispose();
    void this.wakeLock?.release();
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.shell.querySelector<T>(selector);
    if (!element) throw new Error(`Thiếu phần tử UI: ${selector}`);
    return element;
  }
}

export function sequence(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
