import { escapeHtml, FlickDetector, initials, PhoneConnection, sequence, TiltController, uiIcon, type PartyState, type Seat } from '@pocket/party-kit';
import { LIVES, type RaceView } from './MarbleRace';
import { formatSeconds } from './MarbleRenderer';
import { stepTray, type TrayState } from './physics';
import type { MarbleBuzz, MarbleBuzzKind, MarbleCommand } from './protocol';

const SEND_INTERVAL_MS = 33;
/** Bi trong khay lệch quá mức này thì rung nhẹ một cái để kịp nghiêng lại. */
const DANGER_LEVEL = 0.75;

const VIBRATION: Record<MarbleBuzzKind, number | number[]> = {
  gem: 12,
  bump: 45,
  boost: [20, 30, 20],
  fall: [120, 60, 120],
  drop: [90, 40, 90, 40, 90],
  finish: [60, 40, 60, 40, 180],
  out: [300, 80, 300],
};

const TOASTS: Record<MarbleBuzzKind, string> = {
  gem: '+♦',
  bump: 'CỘP!',
  boost: 'TĂNG TỐC!',
  fall: 'RƠI HỐ!',
  drop: 'RƠI BI!',
  finish: 'VỀ ĐÍCH!',
  out: 'BỊ LOẠI',
};

/**
 * Tay cầm Marble: điện thoại là "tấm bìa". Nghiêng trái/phải để lái viên bi trên TV, hất máy lên để nhảy.
 * Viên bi trong khay là bản dự đoán cục bộ; rơi hay không do TV quyết định. Mọi sự kiện trên đường đua
 * (ngọc, va, rơi, về đích…) rung điện thoại ngay lập tức, mỗi loại một kiểu.
 */
export class MarblePhoneApp {
  private readonly link: PhoneConnection<RaceView, MarbleBuzz, MarbleCommand>;
  private readonly tilt = new TiltController();
  private readonly flick = new FlickDetector();
  private steer: 'tilt' | 'buttons' = TiltController.supported() ? 'tilt' : 'buttons';
  private dangerWarned = false;
  private held = { left: false, right: false };
  private buttonTilt = 0;
  private readonly tray: TrayState = { position: 0, velocity: 0 };
  private lastFrame = performance.now();
  private lastSent = 0;
  private playing = false;
  private lastDrops = 0;
  private lastLives = LIVES;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = this.template();
    this.link = new PhoneConnection(this.query('[data-phone-shell]'));
    this.link.onDispose = () => {
      this.tilt.disable();
      this.flick.stop();
    };
    this.bindNetwork();
    this.bindUi();
    this.link.start();
    this.applySteer();
    requestAnimationFrame(this.frame);
  }

  private get network() {
    return this.link.network;
  }

  private bindNetwork(): void {
    this.network.onView = (view, party, seat) => this.render(view, party, seat);
    this.network.onEvent = ({ kind }) => this.buzz(kind);
    this.network.onAck = (_seq, accepted, reason) => {
      if (!accepted && reason) this.query('[data-feedback]').textContent = reason;
    };
  }

  private bindUi(): void {
    this.query<HTMLButtonElement>('[data-phone-restart]').addEventListener('click', () => this.link.sendLobby('restart'));
    this.root.querySelectorAll<HTMLButtonElement>('[data-steer]').forEach((button) => {
      button.addEventListener('click', () => void this.setSteer(button.dataset.steer as 'tilt' | 'buttons'));
    });
    this.tilt.onStatus = (message) => { this.query('[data-tilt-status]').textContent = message; };
    this.query<HTMLButtonElement>('[data-tilt-calibrate]').addEventListener('click', () => this.tilt.calibrate());
    this.flick.onFlick = () => this.jump();

    const hold = (selector: string, side: 'left' | 'right') => {
      const button = this.query<HTMLButtonElement>(selector);
      const release = () => { this.held[side] = false; button.classList.remove('is-held'); };
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        this.held[side] = true;
        button.classList.add('is-held');
      });
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    };
    hold('[data-steer-left]', 'left');
    hold('[data-steer-right]', 'right');

    this.query('[data-tray]').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      void this.link.requestWakeLock();
      // Lần chạm đầu ở chế độ nghiêng: bật cảm biến (iPhone cần thao tác của người dùng mới hỏi quyền).
      if (this.steer === 'tilt' && !this.tilt.enabled) {
        void this.setSteer('tilt');
        return;
      }
      // Chế độ nghiêng nhảy bằng cú hất; chạm khay chỉ còn là dự phòng khi máy không gửi dữ liệu gia tốc.
      if (this.steer === 'tilt' && this.flick.receiving) {
        this.toast('HẤT MÁY LÊN ĐỂ NHẢY', 'hint');
        return;
      }
      this.jump();
    });
    this.query('[data-jump]').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.jump();
    });

    if (!TiltController.supported()) {
      this.query('[data-tilt-status]').textContent = window.isSecureContext
        ? 'Thiết bị không có cảm biến nghiêng — dùng nút bấm.'
        : 'Cảm biến nghiêng cần trang HTTPS. Đang dùng nút bấm.';
    }
  }

  private jump(): void {
    if (!this.playing) return;
    this.network.sendCommand({ type: 'jump', seq: sequence('jump') });
    vibrate(15);
    const tray = this.query('[data-tray]');
    tray.classList.remove('is-jumping');
    requestAnimationFrame(() => tray.classList.add('is-jumping'));
  }

  private async setSteer(mode: 'tilt' | 'buttons'): Promise<void> {
    if (mode === 'tilt' && !this.tilt.enabled) {
      void this.link.requestWakeLock();
      // Xin cả hai quyền trong cùng một lần chạm: iPhone chỉ hỏi quyền khi có thao tác của người dùng.
      const [tiltReady, motionReady] = await Promise.all([this.tilt.enable(), FlickDetector.requestPermission()]);
      if (!tiltReady) mode = 'buttons';
      else if (motionReady) this.flick.start();
    }
    if (mode === 'buttons') {
      this.tilt.disable();
      this.flick.stop();
    }
    this.steer = mode;
    this.applySteer();
  }

  private applySteer(): void {
    const mode = this.steer;
    this.root.querySelectorAll('[data-steer]').forEach((element) => element.classList.toggle('is-active', (element as HTMLElement).dataset.steer === mode));
    this.query('[data-tilt-panel]').classList.toggle('is-hidden', mode !== 'tilt');
    this.query('[data-button-panel]').classList.toggle('is-hidden', mode !== 'buttons');
    const label = mode === 'tilt' && !this.tilt.enabled
      ? 'CHẠM KHAY ĐỂ BẬT CẢM BIẾN'
      : `${this.flicking ? 'HẤT MÁY LÊN' : 'CHẠM KHAY'} ĐỂ NHẢY · GIỮ BI ĐỪNG ĐỂ RƠI`;
    this.query('[data-tray-label]').textContent = label;
    this.query('[data-tray]').setAttribute('aria-label', label);
  }

  /** Đang nhảy bằng cú hất (nghiêng máy + có cảm biến gia tốc). */
  private get flicking(): boolean {
    return this.steer === 'tilt' && this.flick.active;
  }

  private buzz(kind: MarbleBuzzKind): void {
    vibrate(VIBRATION[kind]);
    this.toast(TOASTS[kind], kind);
  }

  private toast(text: string, kind: string): void {
    const element = this.query('[data-tray-toast]');
    element.textContent = text;
    element.dataset.kind = kind;
    element.classList.remove('is-active');
    void element.offsetWidth;
    element.classList.add('is-active');
  }

  private readonly frame = (now: number): void => {
    const elapsed = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const target = (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
    this.buttonTilt += (target - this.buttonTilt) * Math.min(1, elapsed * 10);
    const tilt = this.steer === 'tilt' ? this.tilt.value : this.buttonTilt;

    if (this.playing) {
      // Dự đoán cục bộ cho mượt; chạm mép thì giữ ở mép chờ TV xác nhận rơi.
      if (stepTray(this.tray, tilt, elapsed)) this.tray.position = Math.sign(tilt) || 1;
      // Rung báo trước một lần khi bi sắp lăn ra mép khay.
      const danger = Math.abs(this.tray.position);
      if (danger > DANGER_LEVEL && !this.dangerWarned) {
        this.dangerWarned = true;
        vibrate(25);
      } else if (danger < DANGER_LEVEL * 0.6) {
        this.dangerWarned = false;
      }
      if (now - this.lastSent >= SEND_INTERVAL_MS) {
        this.lastSent = now;
        this.network.sendMotion({ tilt });
      }
    }
    const marble = this.query<HTMLElement>('[data-tray-marble]');
    marble.style.setProperty('--tray', String(this.tray.position));
    marble.style.setProperty('--roll', `${this.tray.position * 540}deg`);
    this.query('[data-tray]').classList.toggle('is-danger', Math.abs(this.tray.position) > 0.72);
    this.query<HTMLElement>('[data-tilt-meter]').style.setProperty('--tilt', String(tilt));
    requestAnimationFrame(this.frame);
  };

  private render(view: RaceView | null, party: PartyState, seat: Seat): void {
    this.link.setStage(party.stage);
    this.link.seat.render(party, seat);
    const me = view && seat.player !== null ? view.racers[seat.player] : undefined;
    this.playing = party.stage === 'party' && Boolean(me) && view?.phase === 'racing' && me?.status !== 'finished' && me?.status !== 'out';

    if (me) {
      if (me.lives < this.lastLives) {
        this.query('[data-feedback]').textContent = me.lives > 0
          ? `Mất 1 mạng — còn ${me.lives} ♥. ${me.drops > this.lastDrops ? 'Đừng nghiêng gắt quá lâu.' : `Nhớ ${this.jumpHint} để nhảy qua hố.`}`
          : 'Hết mạng — bạn bị loại khỏi cuộc đua.';
      }
      if (me.drops > this.lastDrops) {
        this.tray.position = 0;
        this.tray.velocity = 0;
      } else if (this.playing) {
        // Kéo dần dự đoán cục bộ về giá trị TV đang dùng.
        this.tray.position += (me.tray - this.tray.position) * 0.3;
      }
      this.lastDrops = me.drops;
      this.lastLives = me.lives;
    } else {
      this.lastDrops = 0;
      this.lastLives = LIVES;
    }
    if (!this.playing) {
      this.tray.position = 0;
      this.tray.velocity = 0;
    }
    this.renderStatus(view, party, seat, me);
    this.renderStandings(view, party, seat);
  }

  private renderStatus(view: RaceView | null, party: PartyState, seat: Seat, me: RaceView['racers'][number] | undefined): void {
    const kicker = this.query('[data-race-kicker]');
    const title = this.query('[data-race-title]');
    const message = this.query('[data-race-message]');
    const shell = this.query('[data-phone-shell]');
    shell.classList.toggle('is-my-turn', this.playing);
    if (party.stage === 'local') {
      kicker.textContent = 'ĐANG ĐUA TRÊN MÀN HÌNH CHÍNH';
      title.textContent = 'Bàn phím';
      message.textContent = 'Ván này chơi bằng bàn phím. Theo dõi bảng xếp hạng bên dưới.';
      return;
    }
    if (!view || !me) {
      kicker.textContent = 'ĐƯỜNG ĐUA BI';
      title.textContent = seat.member ? 'Ván sau' : 'Đang xem';
      message.textContent = view ? 'Bạn vào khi cuộc đua đã bắt đầu — sẽ đua từ ván kế tiếp.' : 'Chờ chủ phòng bắt đầu.';
      return;
    }
    const count = view.racers.length;
    if (view.phase === 'countdown') {
      kicker.textContent = 'SẮP XUẤT PHÁT';
      title.textContent = String(Math.max(1, Math.ceil(view.countdown)));
      message.textContent = 'Cầm máy như cầm khay, giữ cho viên bi nằm giữa.';
    } else if (me.status === 'out') {
      kicker.textContent = `BỊ LOẠI · ĐI ĐƯỢC ${Math.round(me.progress * 100)}% ĐƯỜNG`;
      title.textContent = 'Hết mạng!';
      message.textContent = view.phase === 'finished' ? 'Cuộc đua đã kết thúc.' : 'Xem những người còn lại về đích trên TV…';
    } else if (me.status === 'finished' || view.phase === 'finished') {
      kicker.textContent = me.finishTime === null ? 'HẾT GIỜ' : `VỀ ĐÍCH · ${formatSeconds(me.finishTime)} − ${me.gems} ♦`;
      title.textContent = `Hạng ${me.rank}/${count}`;
      message.textContent = view.phase === 'finished' ? 'Cuộc đua đã kết thúc.' : 'Chờ những người còn lại về đích…';
    } else {
      kicker.textContent = `♥ ${me.lives}/${LIVES} · ♦ ${me.gems} · ${Math.round(me.progress * 100)}% ĐƯỜNG`;
      title.textContent = `Hạng ${me.rank}/${count}`;
      message.textContent = me.status === 'falling'
        ? 'Rơi hố rồi — đang đặt lại bi…'
        : me.stunned ? 'Choáng! Bi chậm lại một chút.'
          : view.graceLeft !== null ? `Còn ${Math.ceil(view.graceLeft)} giây để về đích!` : `Nghiêng để lái · ${this.jumpHint} để nhảy qua hố.`;
    }
  }

  private renderStandings(view: RaceView | null, party: PartyState, seat: Seat): void {
    const visible = Boolean(view) && party.stage !== 'lobby';
    this.query('[data-standings]').classList.toggle('is-hidden', !visible);
    if (!view || !visible) return;
    const rows = view.racers.map((racer, index) => ({ racer, index })).sort((a, b) => a.racer.rank - b.racer.rank);
    this.query('[data-standings-title]').textContent = view.phase === 'finished' ? 'Kết quả · mỗi ♦ trừ 0,5 giây' : 'Bảng xếp hạng';
    this.query('[data-standings-list]').innerHTML = rows.map(({ racer, index }) => `<li class="${index === seat.player ? 'is-me' : ''}" style="--player-color: ${racer.color}">
      <b>${racer.rank}</b><i>${escapeHtml(initials(racer.name))}</i><span>${escapeHtml(racer.name)}${racer.bot ? ' · BOT' : ''}</span><small>♦${racer.gems}</small><strong>${racer.score !== null ? formatSeconds(racer.score) : racer.status === 'out' ? 'LOẠI' : `${Math.round(racer.progress * 100)}%`}</strong>
    </li>`).join('');
    this.query('[data-phone-restart]').classList.toggle('is-hidden', !(view.phase === 'finished' && seat.leader));
  }

  private get jumpHint(): string {
    return this.flicking ? 'hất máy lên' : this.steer === 'tilt' ? 'chạm khay' : 'bấm NHẢY';
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Thiếu phần tử UI: ${selector}`);
    return element;
  }

  private template(): string {
    return `<main class="phone-shell marble-phone" data-phone-shell data-stage="offline">
      ${PhoneConnection.headerHtml('MARBLE', '<div class="brand-marble" aria-hidden="true"></div>')}

      <section class="phone-game-state"><span data-race-kicker>ĐƯỜNG ĐUA BI</span><strong data-race-title>—</strong><p data-race-message>Kết nối với màn hình chính để bắt đầu.</p></section>

      <div class="phone-play">
        <div class="tray" data-tray role="button" aria-label="Chạm khay để bật cảm biến">
          <div class="tray-board"><span class="tray-edge"></span><i class="tray-marble" data-tray-marble></i><span class="tray-edge"></span><strong class="tray-toast" data-tray-toast aria-live="polite"></strong></div>
          <small data-tray-label>CHẠM KHAY ĐỂ BẬT CẢM BIẾN</small>
        </div>
        <div class="tilt-meter" data-tilt-meter aria-hidden="true"><i></i></div>

        <nav class="mode-tabs"><button data-steer="tilt">NGHIÊNG MÁY</button><button class="is-active" data-steer="buttons">NÚT BẤM</button></nav>
        <section class="tilt-panel is-hidden" data-tilt-panel>
          <p data-tilt-status>Cầm máy như cầm khay: nghiêng trái/phải để lái, hất lên để nhảy. iPhone sẽ hỏi quyền cảm biến.</p>
          <div class="motion-actions"><button data-tilt-calibrate>ĐẶT LÀM MẶT PHẲNG</button></div>
        </section>
        <section class="steer-pad" data-button-panel>
          <button data-steer-left aria-label="Lái trái">${uiIcon('left')}</button>
          <button class="steer-jump" data-jump>NHẢY</button>
          <button data-steer-right aria-label="Lái phải">${uiIcon('right')}</button>
        </section>
        <p class="safety-copy" data-tilt-status-hint>Giữ chắc điện thoại. Nghiêng vừa phải là đủ lái — nghiêng hết cỡ quá lâu sẽ làm rơi bi khỏi khay.</p>
      </div>

      <section class="phone-standings is-hidden" data-standings aria-label="Bảng xếp hạng">
        <div class="phone-section-head"><b data-standings-title>Bảng xếp hạng</b></div>
        <ol class="standings-list" data-standings-list></ol>
        <button class="primary-button phone-wide-button is-hidden" data-phone-restart>ĐUA LẠI</button>
      </section>
      <footer class="phone-feedback" data-feedback>Mỗi sự kiện trên đường đua đều rung điện thoại — mỗi loại một kiểu.</footer>
    </main>`;
  }
}

/** Trình duyệt chặn rung trước lần chạm đầu tiên vào trang; iPhone không hỗ trợ rung trên web. */
function vibrate(pattern: number | number[]): void {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  navigator.vibrate?.(pattern);
}
