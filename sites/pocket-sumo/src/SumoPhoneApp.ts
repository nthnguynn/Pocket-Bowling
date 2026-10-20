import { escapeHtml, initials, PhoneConnection, sequence, type PartyState, type Seat } from '@pocket/party-kit';
import type { BuzzKind, SumoBuzz, SumoCommand } from './protocol';
import { JoystickPad } from './JoystickPad';
import { DASH_COOLDOWN, PUFF_COOLDOWN } from './physics';
import { VARIANT_LABELS, type FighterView, type SumoView } from './SumoMatch';

const SEND_INTERVAL_MS = 33;
/** Rung báo sát mép không lặp lại dày hơn thế này. */
const DANGER_BUZZ_MS = 1_500;

/** Rung theo sự kiện; iPhone không hỗ trợ rung trên web nên luôn có phản hồi hình ảnh đi kèm. */
const VIBRATION: Partial<Record<BuzzKind, (strength: number) => number | number[]>> = {
  hit: (strength) => Math.round(35 + strength * 70),
  land: () => 22,
  fall: () => [90, 50, 220],
  ko: () => [30, 40, 30, 40, 60],
  'round-win': () => [60, 40, 60, 40, 160],
  'match-win': () => [80, 50, 80, 50, 80, 50, 260],
  warn: () => [40, 70, 40],
};

const TOASTS: Partial<Record<BuzzKind, string>> = {
  hit: 'BỊ HÚC!',
  land: 'TRÚNG!',
  fall: 'RƠI RỒI!',
  ko: 'KO! +1',
  'round-win': 'THẮNG VÒNG!',
  'match-win': 'VÔ ĐỊCH!',
  warn: 'SÀN SẮP SỤP!',
};

/**
 * Tay cầm Pocket Sumo: cả màn hình là vùng điều khiển, chỉ cần cảm ứng (không cần cảm biến hay HTTPS).
 * Ở sảnh chờ đã điều khiển được nhân vật trên sàn khởi động; vào trận thì giao diện thu gọn chỉ còn vùng chạm.
 */
export class SumoPhoneApp {
  private readonly link: PhoneConnection<SumoView, SumoBuzz, SumoCommand>;
  private readonly pad: JoystickPad;
  private view: SumoView | null = null;
  private party: PartyState | null = null;
  private seat: Seat | null = null;
  private lastSent = 0;
  /** Dự đoán hồi chiêu cục bộ cho phản hồi tức thì; TV vẫn là bên quyết định. */
  private cooldownUntil = 0;
  private cooldownFull = DASH_COOLDOWN;
  private wasReady = true;
  private lastDangerBuzz = 0;
  private lastStatus = '';

  constructor(private readonly root: HTMLElement) {
    document.body.classList.add('immersive-controller');
    this.root.innerHTML = this.template();
    this.link = new PhoneConnection(this.query('[data-phone-shell]'));
    this.pad = new JoystickPad(this.query('[data-pad]'));
    this.link.onDispose = () => this.pad.dispose();
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
    this.network.onEvent = ({ kind, strength }) => this.buzz(kind, strength);
    this.network.onAck = (_seq, accepted, reason) => {
      if (!accepted && reason) this.query('[data-feedback]').textContent = reason;
    };
  }

  private bindUi(): void {
    this.query<HTMLButtonElement>('[data-phone-restart]').addEventListener('click', () => this.link.sendLobby('restart'));
    this.pad.onTouchStart = () => {
      void this.link.requestWakeLock();
      this.query('[data-pad]').classList.add('was-touched');
    };
    this.pad.onDash = (x, y) => this.dash(x, y);
    const fullscreen = this.query<HTMLButtonElement>('[data-fullscreen]');
    fullscreen.classList.toggle('is-hidden', !document.fullscreenEnabled);
    fullscreen.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    });
    document.addEventListener('fullscreenchange', () => {
      fullscreen.textContent = document.fullscreenElement ? '⤡ THOÁT' : '⤢ TOÀN MÀN HÌNH';
    });
  }

  private get me(): FighterView | undefined {
    const member = this.seat?.member;
    return member ? this.view?.fighters.find((fighter) => fighter.key === member) : undefined;
  }

  /** Điện thoại này có đang điều khiển một nhân vật (ở sàn khởi động hoặc trong trận) không. */
  private get controlling(): boolean {
    const me = this.me;
    if (!me || !this.party || !this.view) return false;
    if (this.party.stage === 'lobby') return this.view.phase === 'practice';
    return this.party.stage === 'party' && this.seat?.player !== null;
  }

  private dash(x: number, y: number): void {
    const now = performance.now();
    if (now < this.cooldownUntil - 200) {
      this.flash('is-denied');
      return;
    }
    if (!this.network.sendCommand({ type: 'dash', seq: sequence('dash'), x, y })) return;
    const ghost = this.me?.status === 'ghost';
    this.cooldownFull = ghost ? PUFF_COOLDOWN : DASH_COOLDOWN;
    this.cooldownUntil = now + this.cooldownFull * 1000;
    this.wasReady = false;
    vibrate(14);
  }

  private readonly frame = (now: number): void => {
    const controlling = this.controlling;
    if (controlling && now - this.lastSent >= SEND_INTERVAL_MS) {
      this.lastSent = now;
      this.network.sendMotion({ x: round3(this.pad.value.x), y: round3(this.pad.value.y), touch: this.pad.touching ? 1 : 0 });
    }
    const remaining = Math.max(0, this.cooldownUntil - now) / 1000;
    this.pad.cooldown = Math.min(1, remaining / this.cooldownFull);
    if (remaining === 0 && !this.wasReady) {
      // Hồi chiêu xong: rung nhẹ một nhịp để không cần nhìn xuống máy.
      this.wasReady = true;
      if (controlling) {
        vibrate(8);
        this.flash('is-ready');
      }
    }
    requestAnimationFrame(this.frame);
  };

  private render(view: SumoView | null, party: PartyState, seat: Seat): void {
    this.view = view;
    this.party = party;
    this.seat = seat;
    this.link.setStage(party.stage);
    this.link.seat.render(party, seat);
    const me = this.me;
    const shell = this.query('[data-phone-shell]');
    const playing = party.stage === 'party' && Boolean(me) && view?.phase !== 'matchEnd';
    shell.classList.toggle('is-playing', playing);
    document.body.classList.toggle('is-immersive', playing);

    this.pad.color = me?.color ?? '#ff78bd';
    const active = this.controlling && (view?.phase === 'fight' || view?.phase === 'practice');
    this.pad.mode = !active ? 'idle' : me?.status === 'ghost' ? 'ghost' : me?.status === 'alive' ? 'fighter' : 'idle';
    if (!active) this.pad.release();
    this.pad.danger = me?.danger ?? 0;
    shell.classList.toggle('is-ghost', me?.status === 'ghost');

    if (me && view) {
      // Đồng bộ hồi chiêu với TV nếu TV đang chậm hơn dự đoán (ví dụ lệnh húc bị từ chối).
      const full = me.status === 'ghost' ? PUFF_COOLDOWN : DASH_COOLDOWN;
      const hostRemaining = me.cooldown * full * 1000;
      const localRemaining = Math.max(0, this.cooldownUntil - performance.now());
      if (hostRemaining > localRemaining + 150) {
        this.cooldownFull = full;
        this.cooldownUntil = performance.now() + hostRemaining;
        this.wasReady = false;
      }
      if (me.danger > 0.75 && view.phase === 'fight' && performance.now() - this.lastDangerBuzz > DANGER_BUZZ_MS) {
        this.lastDangerBuzz = performance.now();
        vibrate([25, 40, 25]);
      }
    }

    this.renderStatus(view, party, seat, me);
    this.renderStandings(view, party, seat);
  }

  private renderStatus(view: SumoView | null, party: PartyState, seat: Seat, me: FighterView | undefined): void {
    let kicker = 'ĐẤU SUMO';
    let title = '—';
    let message = 'Kết nối với màn hình chính để bắt đầu.';
    let hint = '';
    if (party.stage === 'local') {
      kicker = 'ĐANG ĐẤU TRÊN MÀN HÌNH CHÍNH';
      title = 'Bàn phím';
      message = 'Ván này chơi bằng bàn phím. Theo dõi kết quả bên dưới.';
    } else if (party.stage === 'lobby') {
      kicker = 'SÀN KHỞI ĐỘNG';
      title = me ? 'Chạy thử đi!' : 'Đang vào sàn…';
      message = 'Nhân vật màu của bạn đang ở trên TV. Thử kéo và vuốt trước khi vào trận.';
      hint = 'Đặt ngón cái bất kỳ đâu · kéo để chạy · vuốt nhanh rồi thả để HÚC';
    } else if (!view || !me) {
      title = seat.member ? 'Ván sau' : 'Đang xem';
      message = 'Bạn vào khi trận đã bắt đầu — sẽ đấu từ trận kế tiếp.';
    } else {
      const label = `VÒNG ${view.round} · ${VARIANT_LABELS[view.variant].toUpperCase()}`;
      const winner = view.roundWinner ? view.fighters.find((fighter) => fighter.key === view.roundWinner) : undefined;
      if (view.phase === 'countdown') {
        kicker = label;
        title = String(Math.max(1, Math.ceil(view.countdown)));
        message = 'Mắt nhìn TV — đẩy đối thủ ra khỏi sàn!';
      } else if (view.phase === 'roundEnd') {
        kicker = `KẾT THÚC VÒNG ${view.round}`;
        title = winner?.key === me.key ? 'Bạn thắng vòng!' : winner ? `${winner.name} thắng` : 'Hòa!';
        message = `Bạn có ${me.wins}/${view.winRounds} vòng thắng · ${me.kos} lần hất văng.`;
      } else if (view.phase === 'matchEnd') {
        const rank = view.ranking.indexOf(me.key) + 1;
        kicker = 'KẾT THÚC TRẬN';
        title = rank === 1 ? 'Vô địch!' : `Hạng ${rank}/${view.fighters.length}`;
        message = `${me.wins} vòng thắng · ${me.kos} lần hất văng.`;
      } else if (me.status === 'ghost') {
        kicker = `${label} · CÒN ${view.alive} NGƯỜI`;
        title = 'Bạn là hồn ma';
        message = 'Bay tới cạnh người còn sống rồi vuốt để THỔI họ ra mép!';
        hint = 'Kéo để bay · vuốt để thổi';
      } else if (me.status === 'falling') {
        kicker = label;
        title = 'Rơi rồi!';
        message = 'Sắp hóa hồn ma — vẫn còn quậy được.';
      } else {
        kicker = `${label} · CÒN ${view.alive} NGƯỜI`;
        title = me.danger > 0.75 ? 'SÁT MÉP!' : 'Trên sàn';
        message = me.danger > 0.75 ? 'Kéo về giữa sàn ngay!' : 'Vuốt nhanh để húc · chạm thêm ngón thứ hai cũng húc.';
        hint = 'Kéo để chạy · vuốt để húc';
      }
    }
    const pips = me && view && party.stage === 'party'
      ? Array.from({ length: view.winRounds }, (_, index) => `<i class="${index < me.wins ? 'is-won' : ''}"></i>`).join('')
      : '';
    const key = [kicker, title, message, hint, pips].join('|');
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.query('[data-sumo-kicker]').textContent = kicker;
    this.query('[data-sumo-title]').textContent = title;
    this.query('[data-sumo-message]').textContent = message;
    this.query('[data-player-pips]').innerHTML = pips;
    this.query('[data-pad-hint]').textContent = hint;
  }

  private renderStandings(view: SumoView | null, party: PartyState, seat: Seat): void {
    const visible = Boolean(view) && (party.stage === 'local' || view?.phase === 'matchEnd') && view?.phase !== 'practice';
    this.query('[data-standings]').classList.toggle('is-hidden', !visible);
    if (!view || !visible) return;
    this.query('[data-standings-title]').textContent = view.phase === 'matchEnd' ? 'Kết quả · ● là vòng thắng' : 'Bảng điểm';
    this.query('[data-standings-list]').innerHTML = view.ranking.map((key, index) => {
      const fighter = view.fighters.find((entry) => entry.key === key)!;
      return `<li class="${key === seat.member ? 'is-me' : ''}" style="--player-color: ${fighter.color}">
        <b>${index + 1}</b><i>${escapeHtml(initials(fighter.name))}</i><span>${escapeHtml(fighter.name)}${fighter.bot ? ' · BOT' : ''}</span><small>${fighter.kos} KO</small><strong>${fighter.wins} ●</strong>
      </li>`;
    }).join('');
    this.query('[data-phone-restart]').classList.toggle('is-hidden', !(view.phase === 'matchEnd' && seat.leader));
  }

  private buzz(kind: BuzzKind, strength: number): void {
    const pattern = VIBRATION[kind];
    if (pattern) vibrate(pattern(strength));
    const toast = TOASTS[kind];
    if (toast) {
      const element = this.query('[data-pad-toast]');
      element.textContent = toast;
      element.dataset.kind = kind;
      element.classList.remove('is-active');
      void element.offsetWidth;
      element.classList.add('is-active');
    }
    this.flash(kind === 'hit' || kind === 'fall' ? 'is-hit' : kind === 'warn' ? 'is-warn' : 'is-good');
  }

  /** Nháy/rung khung vùng chạm bằng CSS (chạy lại animation mỗi lần gọi). */
  private flash(className: string): void {
    const pad = this.query('[data-pad]');
    pad.classList.remove(className);
    void pad.offsetWidth;
    pad.classList.add(className);
    window.setTimeout(() => pad.classList.remove(className), 500);
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Thiếu phần tử UI: ${selector}`);
    return element;
  }

  private template(): string {
    return `<main class="phone-shell immersive-phone" data-phone-shell data-stage="offline">
      ${PhoneConnection.headerHtml('SUMO', '<div class="brand-sumo" aria-hidden="true"><i></i></div>')}

      <section class="phone-status-card">
        <div><span data-sumo-kicker>ĐẤU SUMO</span><strong data-sumo-title>—</strong><p data-sumo-message>Kết nối với màn hình chính để bắt đầu.</p></div>
        <div class="phone-status-card-side"><span class="player-pips" data-player-pips></span><button class="sumo-fullscreen is-hidden" data-fullscreen type="button">⤢ TOÀN MÀN HÌNH</button></div>
      </section>

      <section class="sumo-pad" data-pad aria-label="Vùng điều khiển: kéo để chạy, vuốt để húc">
        <p class="pad-hint" data-pad-hint></p>
        <strong class="pad-toast" data-pad-toast aria-live="polite"></strong>
      </section>

      <section class="phone-standings is-hidden" data-standings aria-label="Bảng điểm">
        <div class="phone-section-head"><b data-standings-title>Bảng điểm</b></div>
        <ol class="standings-list" data-standings-list></ol>
        <button class="primary-button phone-wide-button is-hidden" data-phone-restart>ĐẤU LẠI</button>
      </section>
      <footer class="phone-feedback" data-feedback>Chỉ cần cảm ứng — không cần bật cảm biến hay HTTPS.</footer>
    </main>`;
  }
}

/** Trình duyệt chặn rung trước lần chạm đầu tiên vào trang; iPhone không hỗ trợ rung trên web. */
function vibrate(pattern: number | number[]): void {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  navigator.vibrate?.(pattern);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
