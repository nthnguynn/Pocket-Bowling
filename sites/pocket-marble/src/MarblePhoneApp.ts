import { escapeHtml, initials, PhoneConnection, sequence, TiltController, type PartyState, type Seat } from '@pocket/party-kit';
import { LIVES, type RaceView } from './MarbleRace';
import { formatSeconds } from './MarbleRenderer';
import { stepTray, type TrayState } from './physics';
import type { MarbleCommand } from './protocol';

const SEND_INTERVAL_MS = 33;

/**
 * Tay cầm Pocket Marble: điện thoại là "tấm bìa". Nghiêng trái/phải để lái viên bi trên TV,
 * chạm khay để nhảy. Viên bi trong khay là bản dự đoán cục bộ; rơi hay không do TV quyết định.
 */
export class MarblePhoneApp {
  private readonly link: PhoneConnection<RaceView, never, MarbleCommand>;
  private readonly tilt = new TiltController();
  private steer: 'tilt' | 'buttons' = 'buttons';
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
    this.link.onDispose = () => this.tilt.disable();
    this.bindNetwork();
    this.bindUi();
    this.link.start();
    requestAnimationFrame(this.frame);
  }

  private get network() {
    return this.link.network;
  }

  private bindNetwork(): void {
    this.network.onView = (view, party, seat) => this.render(view, party, seat);
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

    const jump = (event: Event) => {
      event.preventDefault();
      if (!this.playing) return;
      this.network.sendCommand({ type: 'jump', seq: sequence('jump') });
      navigator.vibrate?.(15);
      const tray = this.query('[data-tray]');
      tray.classList.remove('is-jumping');
      requestAnimationFrame(() => tray.classList.add('is-jumping'));
    };
    this.query('[data-tray]').addEventListener('pointerdown', jump);
    this.query('[data-jump]').addEventListener('pointerdown', jump);

    if (!TiltController.supported()) {
      this.query('[data-tilt-status]').textContent = window.isSecureContext
        ? 'Thiết bị không có cảm biến nghiêng — dùng nút bấm.'
        : 'Cảm biến nghiêng cần trang HTTPS. Đang dùng nút bấm.';
    }
  }

  private async setSteer(mode: 'tilt' | 'buttons'): Promise<void> {
    if (mode === 'tilt' && !this.tilt.enabled) {
      void this.link.requestWakeLock();
      if (!await this.tilt.enable()) return;
    }
    if (mode === 'buttons') this.tilt.disable();
    this.steer = mode;
    this.root.querySelectorAll('[data-steer]').forEach((element) => element.classList.toggle('is-active', (element as HTMLElement).dataset.steer === mode));
    this.query('[data-tilt-panel]').classList.toggle('is-hidden', mode !== 'tilt');
    this.query('[data-button-panel]').classList.toggle('is-hidden', mode !== 'buttons');
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
          ? `Mất 1 mạng — còn ${me.lives} ♥. ${me.drops > this.lastDrops ? 'Đừng nghiêng gắt quá lâu.' : 'Nhớ chạm khay để nhảy qua hố.'}`
          : 'Hết mạng — bạn bị loại khỏi cuộc đua.';
        navigator.vibrate?.(me.lives > 0 ? [120, 60, 120] : [300, 80, 300]);
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
      kicker.textContent = me.finishTime === null ? 'HẾT GIỜ' : `VỀ ĐÍCH · ${formatSeconds(me.finishTime)} − ${me.gems} ◆`;
      title.textContent = `Hạng ${me.rank}/${count}`;
      message.textContent = view.phase === 'finished' ? 'Cuộc đua đã kết thúc.' : 'Chờ những người còn lại về đích…';
    } else {
      kicker.textContent = `${'♥'.repeat(me.lives)}${'♡'.repeat(Math.max(0, LIVES - me.lives))} · ◆ ${me.gems} · ${Math.round(me.progress * 100)}% ĐƯỜNG`;
      title.textContent = `Hạng ${me.rank}/${count}`;
      message.textContent = me.status === 'falling'
        ? 'Rơi hố rồi — đang đặt lại bi…'
        : me.stunned ? 'Choáng! Bi chậm lại một chút.'
          : view.graceLeft !== null ? `Còn ${Math.ceil(view.graceLeft)} giây để về đích!` : 'Nghiêng để lái · chạm khay để nhảy qua hố.';
    }
  }

  private renderStandings(view: RaceView | null, party: PartyState, seat: Seat): void {
    const visible = Boolean(view) && party.stage !== 'lobby';
    this.query('[data-standings]').classList.toggle('is-hidden', !visible);
    if (!view || !visible) return;
    const rows = view.racers.map((racer, index) => ({ racer, index })).sort((a, b) => a.racer.rank - b.racer.rank);
    this.query('[data-standings-title]').textContent = view.phase === 'finished' ? 'Kết quả · mỗi ◆ trừ 0,5 giây' : 'Bảng xếp hạng';
    this.query('[data-standings-list]').innerHTML = rows.map(({ racer, index }) => `<li class="${index === seat.player ? 'is-me' : ''}" style="--player-color: ${racer.color}">
      <b>${racer.rank}</b><i>${escapeHtml(initials(racer.name))}</i><span>${escapeHtml(racer.name)}${racer.bot ? ' · BOT' : ''}</span><small>◆${racer.gems}</small><strong>${racer.score !== null ? formatSeconds(racer.score) : racer.status === 'out' ? 'LOẠI' : `${Math.round(racer.progress * 100)}%`}</strong>
    </li>`).join('');
    this.query('[data-phone-restart]').classList.toggle('is-hidden', !(view.phase === 'finished' && seat.leader));
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
        <div class="tray" data-tray role="button" aria-label="Chạm để nhảy">
          <div class="tray-board"><span class="tray-edge"></span><i class="tray-marble" data-tray-marble></i><span class="tray-edge"></span></div>
          <small>CHẠM KHAY ĐỂ NHẢY · GIỮ BI ĐỪNG ĐỂ RƠI</small>
        </div>
        <div class="tilt-meter" data-tilt-meter aria-hidden="true"><i></i></div>

        <nav class="mode-tabs"><button data-steer="tilt">NGHIÊNG MÁY</button><button class="is-active" data-steer="buttons">NÚT BẤM</button></nav>
        <section class="tilt-panel is-hidden" data-tilt-panel>
          <p data-tilt-status>Bấm "Nghiêng máy" để bật cảm biến. iPhone sẽ hỏi quyền.</p>
          <div class="motion-actions"><button data-tilt-calibrate>ĐẶT LÀM MẶT PHẲNG</button></div>
        </section>
        <section class="steer-pad" data-button-panel>
          <button data-steer-left aria-label="Lái trái">◀</button>
          <button class="steer-jump" data-jump>NHẢY</button>
          <button data-steer-right aria-label="Lái phải">▶</button>
        </section>
        <p class="safety-copy" data-tilt-status-hint>Giữ chắc điện thoại. Nghiêng vừa phải là đủ lái — nghiêng hết cỡ quá lâu sẽ làm rơi bi khỏi khay.</p>
      </div>

      <section class="phone-standings is-hidden" data-standings aria-label="Bảng xếp hạng">
        <div class="phone-section-head"><b data-standings-title>Bảng xếp hạng</b></div>
        <ol class="standings-list" data-standings-list></ol>
        <button class="primary-button phone-wide-button is-hidden" data-phone-restart>ĐUA LẠI</button>
      </section>
      <footer class="phone-feedback" data-feedback>Độ nghiêng gửi 30 lần/giây qua kênh telemetry; lệnh nhảy qua kênh tin cậy.</footer>
    </main>`;
  }
}
