import { escapeHtml, initials, PhoneConnection, sequence, TiltController, type PartyState, type Seat } from '@pocket/party-kit';
import type { BuzzKind, RollBuzz, RollCommand } from './protocol';
import type { RollerView, RollView } from './RollMatch';

const SEND_INTERVAL_MS = 33;

const VIBRATION: Partial<Record<BuzzKind, number | number[]>> = {
  die: [90, 50, 160],
  checkpoint: [20, 40, 20],
  goal: [60, 40, 60, 40, 160],
  land: 18,
};

const TOASTS: Partial<Record<BuzzKind, string>> = {
  die: 'RÁCH GIẤY!',
  checkpoint: 'ĐÃ LƯU CỜ',
  goal: 'GIAO XONG!',
};

/**
 * Tay cầm Pocket Roll: điện thoại là tấm bìa. Nghiêng để lăn cuộn giấy trên TV, chạm để nhảy.
 * Máy có cảm biến thì lần chạm đầu bật nghiêng máy; không có (hoặc trang không HTTPS) thì dùng nút ◀ ▶.
 */
export class RollPhoneApp {
  private readonly link: PhoneConnection<RollView, RollBuzz, RollCommand>;
  private readonly tilt = new TiltController();
  private steer: 'tilt' | 'buttons' = TiltController.supported() ? 'tilt' : 'buttons';
  private held = { left: false, right: false };
  private buttonTilt = 0;
  private view: RollView | null = null;
  private party: PartyState | null = null;
  private seat: Seat | null = null;
  private lastFrame = performance.now();
  private lastSent = 0;
  private touchUntil = 0;
  private lastStatus = '';

  constructor(private readonly root: HTMLElement) {
    document.body.classList.add('immersive-controller');
    this.root.innerHTML = this.template();
    this.link = new PhoneConnection(this.query('[data-phone-shell]'));
    this.link.onDispose = () => this.tilt.disable();
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
    this.root.querySelectorAll<HTMLButtonElement>('[data-steer]').forEach((button) => {
      button.addEventListener('click', () => void this.setSteer(button.dataset.steer as 'tilt' | 'buttons'));
    });
    this.tilt.onStatus = (message) => { this.query('[data-tilt-status]').textContent = message; };
    this.query<HTMLButtonElement>('[data-tilt-calibrate]').addEventListener('click', () => this.tilt.calibrate());
    this.root.querySelectorAll<HTMLButtonElement>('[data-phone-action]').forEach((button) => {
      button.addEventListener('click', () => this.link.sendLobby(button.dataset.phoneAction as 'next' | 'restart'));
    });

    const hold = (selector: string, side: 'left' | 'right') => {
      const button = this.query<HTMLButtonElement>(selector);
      const release = () => { this.held[side] = false; button.classList.remove('is-held'); };
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.setPointerCapture(event.pointerId);
        this.held[side] = true;
        this.touchUntil = performance.now() + 400;
        button.classList.add('is-held');
      });
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    };
    hold('[data-steer-left]', 'left');
    hold('[data-steer-right]', 'right');

    const pad = this.query('[data-roll-pad]');
    pad.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      void this.link.requestWakeLock();
      this.touchUntil = performance.now() + 400;
      // Lần chạm đầu ở chế độ nghiêng: bật cảm biến (iPhone cần thao tác của người dùng mới hỏi quyền).
      if (this.steer === 'tilt' && !this.tilt.enabled) {
        void this.setSteer('tilt');
        return;
      }
      this.jump();
    });
    pad.addEventListener('contextmenu', (event) => event.preventDefault());
    this.query('[data-jump]').addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.jump();
    });
  }

  private jump(): void {
    if (!this.controlling) return;
    this.network.sendCommand({ type: 'jump', seq: sequence('jump') });
    vibrate(12);
    const pad = this.query('[data-roll-pad]');
    pad.classList.remove('is-jumping');
    void pad.offsetWidth;
    pad.classList.add('is-jumping');
  }

  private async setSteer(mode: 'tilt' | 'buttons'): Promise<void> {
    if (mode === 'tilt' && !this.tilt.enabled) {
      void this.link.requestWakeLock();
      if (!await this.tilt.enable()) mode = 'buttons';
    }
    if (mode === 'buttons') this.tilt.disable();
    this.steer = mode;
    this.applySteer();
  }

  private applySteer(): void {
    const mode = this.steer;
    this.root.querySelectorAll('[data-steer]').forEach((element) => element.classList.toggle('is-active', (element as HTMLElement).dataset.steer === mode));
    this.query('[data-tilt-panel]').classList.toggle('is-hidden', mode !== 'tilt');
    this.query('[data-button-panel]').classList.toggle('is-hidden', mode !== 'buttons');
    this.query('[data-pad-label]').textContent = mode === 'tilt' && !this.tilt.enabled
      ? 'CHẠM ĐỂ BẬT NGHIÊNG MÁY'
      : 'CHẠM ĐỂ NHẢY';
    if (!TiltController.supported()) {
      this.query('[data-tilt-status]').textContent = window.isSecureContext
        ? 'Máy không có cảm biến nghiêng — dùng nút bấm.'
        : 'Nghiêng máy cần trang HTTPS. Đang dùng nút bấm.';
    }
  }

  private get me(): RollerView | undefined {
    const member = this.seat?.member;
    return member ? this.view?.rollers.find((roller) => roller.key === member) : undefined;
  }

  /** Điện thoại này có đang điều khiển một cuộn giấy (ở sàn khởi động hoặc trong trận) không. */
  private get controlling(): boolean {
    if (!this.me || !this.party || !this.view) return false;
    if (this.party.stage === 'lobby') return this.view.phase === 'practice';
    return this.party.stage === 'party' && this.seat?.player !== null;
  }

  private readonly frame = (now: number): void => {
    const elapsed = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const target = (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
    this.buttonTilt += (target - this.buttonTilt) * Math.min(1, elapsed * 8);
    const tilt = this.steer === 'tilt' ? this.tilt.value : this.buttonTilt;
    if (this.controlling && now - this.lastSent >= SEND_INTERVAL_MS) {
      this.lastSent = now;
      this.network.sendMotion({ tilt: Math.round(tilt * 1000) / 1000, touch: now < this.touchUntil ? 1 : 0 });
    }
    // Thước thủy: bọt khí chạy ngược hướng nghiêng, nằm giữa là đang cân.
    this.query<HTMLElement>('[data-level-bubble]').style.setProperty('--tilt', String(tilt));
    this.query<HTMLElement>('[data-board]').style.setProperty('--tilt', String(tilt));
    requestAnimationFrame(this.frame);
  };

  private render(view: RollView | null, party: PartyState, seat: Seat): void {
    this.view = view;
    this.party = party;
    this.seat = seat;
    this.link.setStage(party.stage);
    this.link.seat.render(party, seat);
    const me = this.me;
    const shell = this.query('[data-phone-shell]');
    const playing = party.stage === 'party' && Boolean(me) && (view?.phase === 'countdown' || view?.phase === 'playing');
    shell.classList.toggle('is-playing', playing);
    document.body.classList.toggle('is-immersive', playing);
    shell.classList.toggle('is-done', me?.status === 'done');
    this.renderStatus(view, party, seat, me);
    this.renderStandings(view, party, seat);
  }

  private renderStatus(view: RollView | null, party: PartyState, seat: Seat, me: RollerView | undefined): void {
    let kicker = 'CHO XIN CUỘN GIẤY!';
    let title = '—';
    let message = 'Kết nối với màn hình chính để bắt đầu.';
    if (party.stage === 'local') {
      kicker = 'ĐANG CHƠI TRÊN MÀN HÌNH CHÍNH';
      title = 'Bàn phím';
      message = 'Ván này chơi bằng bàn phím. Theo dõi kết quả bên dưới.';
    } else if (party.stage === 'lobby') {
      kicker = view ? `LĂN THỬ · MÀN ${view.levelIndex + 1} · ${view.levelName.toUpperCase()}` : 'LĂN THỬ';
      title = me ? 'Nghiêng thử đi!' : 'Đang vào…';
      message = 'Cuộn giấy màu của bạn đang ở trên TV. Nghiêng máy như cầm tấm bìa để lăn.';
    } else if (!view || !me) {
      title = seat.member ? 'Trận sau' : 'Đang xem';
      message = 'Bạn vào khi trận đã bắt đầu — sẽ chơi từ trận kế tiếp.';
    } else {
      const label = `MÀN ${view.levelIndex + 1}/${view.levelCount} · ${view.levelName.toUpperCase()}`;
      if (view.phase === 'countdown') {
        kicker = label;
        title = String(Math.max(1, Math.ceil(view.countdown)));
        message = view.hint;
      } else if (view.phase === 'levelEnd') {
        kicker = label;
        title = me.finishTime !== null ? `Giao trong ${me.finishTime.toFixed(1)}s` : 'Chưa tới đích';
        message = me.levelPoints ? `+${me.levelPoints} điểm · tổng ${me.points} điểm · chết ${me.deaths} lần` : `Tổng ${me.points} điểm · chết ${me.deaths} lần`;
      } else if (view.phase === 'matchEnd') {
        const rank = view.ranking.indexOf(me.key) + 1;
        kicker = 'HẾT TRẬN';
        title = rank === 1 ? 'Vô địch giao giấy!' : `Hạng ${rank}/${view.rollers.length}`;
        message = `${me.points} điểm sau ${view.levelCount} màn.`;
      } else if (me.status === 'done') {
        kicker = label;
        title = 'Đã giao giấy!';
        message = view.graceLeft !== null ? `Chờ mọi người · còn ${Math.ceil(view.graceLeft)} giây.` : 'Chờ mọi người giao xong…';
      } else {
        kicker = `${label} · CHẾT ${me.deaths}`;
        title = me.status === 'dead' ? 'Rách giấy!' : 'Lăn đi!';
        message = view.graceLeft !== null ? `Còn ${Math.ceil(view.graceLeft)} giây để tới nhà vệ sinh!` : view.hint;
      }
    }
    const key = [kicker, title, message].join('|');
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.query('[data-roll-kicker]').textContent = kicker;
    this.query('[data-roll-title]').textContent = title;
    this.query('[data-roll-message]').textContent = message;
  }

  private renderStandings(view: RollView | null, party: PartyState, seat: Seat): void {
    const results = view?.phase === 'levelEnd' || view?.phase === 'matchEnd';
    const visible = Boolean(view) && (party.stage === 'local' || results) && view?.phase !== 'practice';
    this.query('[data-standings]').classList.toggle('is-hidden', !visible);
    if (!view || !visible) return;
    const final = view.phase === 'matchEnd';
    this.query('[data-standings-title]').textContent = final ? 'Tổng điểm' : `Màn ${view.levelIndex + 1} · ${view.levelName}`;
    this.query('[data-standings-list]').innerHTML = view.ranking.map((key, index) => {
      const roller = view.rollers.find((entry) => entry.key === key)!;
      const score = final ? `${roller.points} đ` : roller.finishTime !== null ? `${roller.finishTime.toFixed(1)}s` : '—';
      return `<li class="${key === seat.member ? 'is-me' : ''}" style="--player-color: ${roller.color}">
        <b>${index + 1}</b><i>${escapeHtml(initials(roller.name))}</i><span>${escapeHtml(roller.name)}</span><small>✕${roller.deaths}</small><strong>${score}</strong>
      </li>`;
    }).join('');
    const leader = seat.leader && party.stage === 'party';
    const canNext = view.phase === 'levelEnd' && view.cleared && view.levelIndex < view.levelCount - 1;
    this.query('[data-phone-action="next"]').classList.toggle('is-hidden', !(leader && canNext));
    const restart = this.query('[data-phone-action="restart"]');
    restart.classList.toggle('is-hidden', !(leader && results));
    restart.textContent = final ? 'CHƠI LẠI TỪ ĐẦU' : 'CHƠI LẠI MÀN';
  }

  private buzz(kind: BuzzKind): void {
    const pattern = VIBRATION[kind];
    if (pattern !== undefined) vibrate(pattern);
    const toast = TOASTS[kind];
    if (!toast) return;
    const element = this.query('[data-pad-toast]');
    element.textContent = toast;
    element.dataset.kind = kind;
    element.classList.remove('is-active');
    void element.offsetWidth;
    element.classList.add('is-active');
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Thiếu phần tử UI: ${selector}`);
    return element;
  }

  private template(): string {
    return `<main class="phone-shell immersive-phone roll-phone" data-phone-shell data-stage="offline">
      ${PhoneConnection.headerHtml('ROLL', '<div class="brand-roll" aria-hidden="true"><i></i></div>')}

      <section class="phone-status-card">
        <div><span data-roll-kicker>CHO XIN CUỘN GIẤY!</span><strong data-roll-title>—</strong><p data-roll-message>Kết nối với màn hình chính để bắt đầu.</p></div>
      </section>

      <section class="roll-play">
        <div class="roll-pad" data-roll-pad role="button" aria-label="Chạm để nhảy">
          <div class="spirit-level" aria-hidden="true"><i data-level-bubble></i></div>
          <div class="roll-board" data-board aria-hidden="true"><i></i></div>
          <b data-pad-label>CHẠM ĐỂ NHẢY</b>
          <strong class="pad-toast" data-pad-toast aria-live="polite"></strong>
        </div>
        <nav class="mode-tabs"><button data-steer="tilt">NGHIÊNG MÁY</button><button data-steer="buttons">NÚT BẤM</button></nav>
        <section class="tilt-panel is-hidden" data-tilt-panel>
          <p data-tilt-status>Cầm máy ngang như cầm tấm bìa, nghiêng trái/phải để lăn.</p>
          <div class="motion-actions"><button data-tilt-calibrate>ĐẶT LÀM MẶT PHẲNG</button></div>
        </section>
        <section class="steer-pad" data-button-panel>
          <button data-steer-left aria-label="Nghiêng trái">◀</button>
          <button class="steer-jump" data-jump>NHẢY</button>
          <button data-steer-right aria-label="Nghiêng phải">▶</button>
        </section>
      </section>

      <section class="phone-standings is-hidden" data-standings aria-label="Kết quả">
        <div class="phone-section-head"><b data-standings-title>Kết quả</b></div>
        <ol class="standings-list" data-standings-list></ol>
        <button class="primary-button phone-wide-button is-hidden" data-phone-action="next">MÀN TIẾP ▶</button>
        <button class="ghost-button phone-wide-button is-hidden" data-phone-action="restart">CHƠI LẠI MÀN</button>
      </section>
      <footer class="phone-feedback" data-feedback>Độ nghiêng gửi 30 lần/giây; lệnh nhảy qua kênh tin cậy.</footer>
    </main>`;
  }
}

/** Trình duyệt chặn rung trước lần chạm đầu tiên vào trang; iPhone không hỗ trợ rung trên web. */
function vibrate(pattern: number | number[]): void {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  navigator.vibrate?.(pattern);
}
