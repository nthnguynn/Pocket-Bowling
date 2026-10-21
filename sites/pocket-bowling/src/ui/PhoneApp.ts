import { escapeHtml, initials, PhoneConnection, sequence, type PartyState, type Seat } from '@pocket/party-kit';
import { MotionController } from '../controller/MotionController';
import { scoreFrames } from '../game/scoring';
import type { BowlingCommand } from '../protocol';
import type { GameSnapshot } from '../types';

export class PhoneApp {
  private readonly link: PhoneConnection<GameSnapshot, never, BowlingCommand>;
  private readonly motion = new MotionController();
  private mode: 'touch' | 'motion' = 'touch';
  private controls = { position: 0, aim: 0, spin: 0, power: 0.65 };
  private charging = false;
  private chargeStarted = 0;
  private chargeFrame = 0;
  private canThrow = false;
  private hasControl = false;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = this.template();
    this.link = new PhoneConnection(this.query('[data-phone-shell]'));
    this.link.onDispose = () => this.motion.disable();
    this.bindNetwork();
    this.bindUi();
    this.link.start();
  }

  private get network() {
    return this.link.network;
  }

  private bindNetwork(): void {
    this.network.onView = (snapshot, party, seat) => {
      if (snapshot) this.renderState(snapshot, party, seat);
    };
    this.network.onAck = (_seq, accepted, reason) => {
      this.query('[data-feedback]').textContent = accepted ? 'Màn hình chính đã nhận lệnh' : (reason ?? 'Lệnh chưa được nhận');
      if (accepted && navigator.vibrate) navigator.vibrate(35);
    };
    this.motion.onStatus = (message) => { this.query('[data-motion-status]').textContent = message; };
    this.motion.onSample = ({ magnitude, spin, peak }) => {
      this.query<HTMLElement>('[data-motion-meter]').style.setProperty('--motion', `${Math.min(100, magnitude * 15)}%`);
      this.query('[data-motion-value]').textContent = `${magnitude.toFixed(1)} m/s²`;
      this.network.sendMotion({ magnitude, spin, peak });
    };
    this.motion.onThrow = (power, spin) => {
      this.controls.power = power;
      this.controls.spin = spin;
      this.sendThrow('phone-motion');
      this.query<HTMLButtonElement>('[data-motion-arm]').textContent = 'CHUẨN BỊ NÉM';
    };
  }

  private bindUi(): void {
    this.query<HTMLButtonElement>('[data-phone-restart]').addEventListener('click', () => this.link.sendLobby('restart'));
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => this.setMode(button.dataset.mode as 'touch' | 'motion'));
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-phone-control]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.phoneControl as 'position' | 'aim' | 'spin';
        this.controls[key] = Number(input.value);
        this.renderControlValue(key);
        // Chưa tới lượt vẫn chỉnh trước được; giá trị được đẩy lên khi tới lượt.
        if (this.hasControl) this.sendAim();
      });
    });

    const throwButton = this.query<HTMLButtonElement>('[data-touch-throw]');
    throwButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!this.canThrow) return;
      void this.link.requestWakeLock();
      throwButton.setPointerCapture(event.pointerId);
      this.startCharge();
    });
    throwButton.addEventListener('pointerup', (event) => {
      event.preventDefault();
      this.releaseCharge();
    });
    throwButton.addEventListener('pointercancel', () => this.cancelCharge());
    throwButton.addEventListener('contextmenu', (event) => event.preventDefault());

    this.query<HTMLButtonElement>('[data-motion-enable]').addEventListener('click', async () => {
      void this.link.requestWakeLock();
      const enabled = await this.motion.enable();
      if (enabled) this.query<HTMLButtonElement>('[data-motion-enable]').textContent = 'CẢM BIẾN ĐÃ BẬT';
    });
    this.query<HTMLButtonElement>('[data-calibrate]').addEventListener('click', () => this.motion.calibrate());
    this.query<HTMLButtonElement>('[data-motion-arm]').addEventListener('click', (event) => {
      if (!this.canThrow) return;
      const armed = !this.motion.armed;
      this.motion.setArmed(armed);
      this.network.sendCommand({ type: armed ? 'prepare' : 'cancel', seq: sequence('prepare') });
      (event.currentTarget as HTMLButtonElement).textContent = armed ? 'HỦY CÚ NÉM' : 'CHUẨN BỊ NÉM';
    });
  }

  private sendAim(): void {
    this.network.sendCommand({ type: 'aim', aim: this.controls.aim, spin: this.controls.spin, position: this.controls.position });
  }

  private setMode(mode: 'touch' | 'motion'): void {
    this.mode = mode;
    this.root.querySelectorAll('[data-mode]').forEach((element) => element.classList.toggle('is-active', (element as HTMLElement).dataset.mode === mode));
    this.query('[data-touch-panel]').classList.toggle('is-hidden', mode !== 'touch');
    this.query('[data-motion-panel]').classList.toggle('is-hidden', mode !== 'motion');
    if (mode === 'touch') this.motion.setArmed(false);
  }

  private startCharge(): void {
    if (this.charging) return;
    this.charging = true;
    this.chargeStarted = performance.now();
    this.network.sendCommand({ type: 'prepare', seq: sequence('prepare') });
    this.chargeFrame = requestAnimationFrame(this.updateCharge);
  }

  private releaseCharge(): void {
    if (!this.charging) return;
    this.charging = false;
    cancelAnimationFrame(this.chargeFrame);
    this.sendThrow('phone-touch');
  }

  private cancelCharge(): void {
    if (!this.charging) return;
    this.charging = false;
    cancelAnimationFrame(this.chargeFrame);
    this.network.sendCommand({ type: 'cancel', seq: sequence('cancel') });
  }

  private readonly updateCharge = (): void => {
    if (!this.charging) return;
    const elapsed = (performance.now() - this.chargeStarted) / 1000;
    const triangle = 1 - Math.abs(((elapsed * 0.75) % 2) - 1);
    this.controls.power = 0.25 + triangle * 0.75;
    const button = this.query<HTMLElement>('[data-touch-throw]');
    button.style.setProperty('--phone-power', `${Math.round(this.controls.power * 100)}%`);
    button.querySelector('strong')!.textContent = `${Math.round(this.controls.power * 100)}%`;
    this.chargeFrame = requestAnimationFrame(this.updateCharge);
  };

  private sendThrow(source: 'phone-touch' | 'phone-motion'): void {
    if (!this.canThrow) return;
    const sent = this.network.sendCommand({
      type: 'throw',
      seq: sequence('throw'),
      ...this.controls,
      source,
    });
    this.query('[data-feedback]').textContent = sent ? 'Đã gửi cú ném…' : 'DataChannel chưa sẵn sàng.';
    if (sent) this.canThrow = false;
  }

  private renderState(snapshot: GameSnapshot, party: PartyState, seat: Seat): void {
    const newTurn = party.stage === 'party' && seat.control && !this.hasControl;
    const couldThrow = this.canThrow;
    this.hasControl = seat.control;
    this.canThrow = snapshot.canThrow && seat.control;
    this.link.setStage(party.stage);
    this.link.seat.render(party, seat);
    this.renderTurn(snapshot, party, seat);
    this.renderStandings(snapshot, party, seat);

    this.query<HTMLButtonElement>('[data-touch-throw]').disabled = !this.canThrow;
    this.query<HTMLButtonElement>('[data-motion-arm]').disabled = !this.canThrow;
    if (!this.canThrow && this.charging) this.cancelCharge();
    if (!this.canThrow && this.motion.armed) {
      this.motion.setArmed(false);
      this.query<HTMLButtonElement>('[data-motion-arm]').textContent = 'CHUẨN BỊ NÉM';
    }

    if (newTurn) {
      this.query('[data-feedback]').textContent = 'Đến lượt bạn! Chỉnh rồi giữ nút để ném.';
      navigator.vibrate?.([80, 60, 80]);
    }
    // Host chỉ nhận cách ngắm khi đang nhắm, nên đẩy cấu hình đã chỉnh sẵn lúc nút ném vừa mở.
    if (party.stage === 'party' && this.canThrow && !couldThrow) this.sendAim();
  }

  private renderTurn(snapshot: GameSnapshot, party: PartyState, seat: Seat): void {
    const player = snapshot.players[snapshot.activePlayer];
    const myTurn = party.stage === 'party' && seat.control;
    const shell = this.query('[data-phone-shell]');
    shell.classList.toggle('is-my-turn', myTurn);
    shell.classList.toggle('is-waiting', party.stage === 'party' && !seat.control);
    this.query('[data-remote-frame]').textContent = myTurn
      ? `ĐẾN LƯỢT BẠN · FRAME ${Math.min(10, (player?.frameIndex ?? 0) + 1)}`
      : `FRAME ${Math.min(10, (player?.frameIndex ?? 0) + 1)} · ${snapshot.standingPins} CHAI`;
    const playerName = this.query('[data-remote-player]');
    playerName.textContent = player?.name ?? '—';
    if (snapshot.players.length > 1 && player) playerName.style.setProperty('--name-color', player.color);
    else playerName.style.removeProperty('--name-color');

    let message = snapshot.message;
    if (party.stage === 'party' && snapshot.phase !== 'GAME_OVER' && !seat.control) {
      const count = snapshot.players.length;
      const wait = seat.player === null ? null : (seat.player - snapshot.activePlayer + count) % count;
      message = seat.player === null
        ? 'Bạn vào sau khi ván bắt đầu — sẽ chơi từ ván kế tiếp.'
        : wait === 1 ? 'Bạn ném ngay sau lượt này — chuẩn bị nhé!' : `Còn ${wait} lượt nữa tới bạn. Có thể chỉnh trước vị trí, hướng, xoáy.`;
    }
    this.query('[data-remote-message]').textContent = message;
  }

  private renderStandings(snapshot: GameSnapshot, party: PartyState, seat: Seat): void {
    const over = snapshot.phase === 'GAME_OVER';
    const visible = party.stage !== 'lobby' && (snapshot.players.length > 1 || over);
    this.query('[data-standings]').classList.toggle('is-hidden', !visible);
    if (!visible) return;
    const rows = snapshot.players.map((player, index) => ({
      player,
      index,
      score: scoreFrames(player.frames).cumulative.reduce<number | null>((last, value) => value ?? last, null) ?? 0,
    })).sort((a, b) => b.score - a.score);
    this.query('[data-standings-title]').textContent = over ? 'Kết quả cuối ván' : 'Bảng điểm';
    this.query('[data-standings-list]').innerHTML = rows.map(({ player, index, score }, rank) => `<li class="${index === seat.player ? 'is-me' : ''} ${index === snapshot.activePlayer && !over ? 'is-active' : ''}" style="--player-color: ${player.color}">
      <b>${rank + 1}</b><i>${escapeHtml(initials(player.name))}</i><span>${escapeHtml(player.name)}</span><small>F${Math.min(10, player.frameIndex + 1)}</small><strong>${score}</strong>
    </li>`).join('');
    this.query('[data-phone-restart]').classList.toggle('is-hidden', !(over && seat.leader));
  }

  private renderControlValue(key: 'position' | 'aim' | 'spin'): void {
    const value = this.query(`[data-phone-value="${key}"]`);
    value.textContent = `${this.controls[key] >= 0 ? '+' : ''}${Math.round(this.controls[key] * 100)}`;
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Thiếu phần tử UI: ${selector}`);
    return element;
  }

  private template(): string {
    return `<main class="phone-shell" data-phone-shell data-stage="offline">
      ${PhoneConnection.headerHtml('CONTROLLER', '<div class="brand-ball"><i></i><i></i><i></i></div>')}

      <section class="phone-game-state"><span data-remote-frame>FRAME —</span><strong data-remote-player>—</strong><p data-remote-message>Kết nối với màn hình chính để bắt đầu.</p></section>

      <div class="phone-play">
        <nav class="mode-tabs"><button class="is-active" data-mode="touch">CẢM ỨNG</button><button data-mode="motion">CHUYỂN ĐỘNG</button></nav>

        <section class="touch-panel" data-touch-panel>
          <div class="phone-sliders">
            <label><span>VỊ TRÍ <b data-phone-value="position">+0</b></span><input data-phone-control="position" type="range" min="-1" max="1" step="0.01" value="0"></label>
            <label><span>HƯỚNG <b data-phone-value="aim">+0</b></span><input data-phone-control="aim" type="range" min="-1" max="1" step="0.01" value="0"></label>
            <label><span>XOÁY <b data-phone-value="spin">+0</b></span><input data-phone-control="spin" type="range" min="-1" max="1" step="0.01" value="0"></label>
          </div>
          <button class="phone-throw" data-touch-throw disabled style="--phone-power: 65%"><span></span><div><small>GIỮ · LẤY LỰC</small><strong>65%</strong><em>THẢ ĐỂ NÉM</em></div></button>
          <p class="safety-copy">Giữ chắc điện thoại trong tay. Không cần và không nên thả máy.</p>
        </section>

        <section class="motion-panel is-hidden" data-motion-panel>
          <div class="motion-orb" data-motion-meter style="--motion: 0%"><span></span><strong data-motion-value>0.0 m/s²</strong><small>CƯỜNG ĐỘ ĐÃ LỌC</small></div>
          <p data-motion-status>Bật cảm biến bằng thao tác chủ động. Nếu bị từ chối, hãy dùng cảm ứng.</p>
          <div class="motion-actions"><button data-motion-enable>BẬT CẢM BIẾN</button><button data-calibrate>HIỆU CHỈNH</button></div>
          <button class="motion-arm" data-motion-arm disabled>CHUẨN BỊ NÉM</button>
          <p class="safety-copy">Vung nhẹ về phía trước. Lực lấy từ cường độ + xung chuyển động; xoáy lấy từ tốc độ quay/góc nghiêng đã lọc.</p>
        </section>
      </div>

      <section class="phone-standings is-hidden" data-standings aria-label="Bảng điểm">
        <div class="phone-section-head"><b data-standings-title>Bảng điểm</b></div>
        <ol class="standings-list" data-standings-list></ol>
        <button class="primary-button phone-wide-button is-hidden" data-phone-restart>CHƠI LẠI</button>
      </section>
      <footer class="phone-feedback" data-feedback>Reliable/ordered DataChannel dùng cho lệnh ném.</footer>
    </main>`;
  }
}
