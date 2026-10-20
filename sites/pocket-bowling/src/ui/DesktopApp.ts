import {
  arcadeUrl, bindThemeToggle, escapeHtml, getTheme, HostLobby, initials, onThemeChange, PartyRoom, WebRTCHost,
  type CommandResult, type NetworkStats, type PartyCommand,
} from '@pocket/party-kit';
import type { CameraMode } from '../game/BowlingRenderer';
import { GameController } from '../game/GameController';
import { rollMarks, scoreFrames } from '../game/scoring';
import { DesktopInput, type DesktopControls } from '../input/DesktopInput';
import { meta } from '../meta';
import { parseBowlingCommand, type BowlingCommand } from '../protocol';
import type { GameSnapshot } from '../types';

const CAMERA_MODES: Array<{ mode: CameraMode; label: string }> = [
  { mode: 'dynamic', label: 'Tự động' },
  { mode: 'chase', label: 'Theo bóng' },
  { mode: 'side', label: 'Ngang sân' },
  { mode: 'pins', label: 'Sau chai' },
  { mode: 'top', label: 'Trên cao' },
];

export class DesktopApp {
  private game!: GameController;
  private readonly input = new DesktopInput();
  private readonly network = new WebRTCHost(parseBowlingCommand);
  private readonly party = new PartyRoom(meta.players.max);
  private readonly lobby: HostLobby;
  private snapshot!: GameSnapshot;
  private room = '';
  private lobbyOpen = true;
  private phonePanelOpen = false;
  private diagnosticsOpen = false;
  private lastStats: NetworkStats = this.network.stats;
  private lastResultKey = '';
  private lastTurnKey = '';
  private cameraMode: CameraMode = 'dynamic';
  private cameraToastTimer = 0;
  private turnBannerTimer = 0;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = this.template();
    this.lobby = new HostLobby(this.root);
    const stage = this.query<HTMLElement>('[data-game-stage]');
    this.game = new GameController(stage, 1);
    this.game.renderer.setTheme(getTheme());
    onThemeChange((theme) => this.game.renderer.setTheme(theme));
    this.bindGame();
    this.bindInput();
    this.bindUi();
    this.input.start();
    this.renderParty();
    void this.startNetwork();
  }

  private bindGame(): void {
    this.game.onSnapshot = (snapshot) => {
      this.snapshot = snapshot;
      this.renderSnapshot();
      this.focusActivePhone();
      this.broadcastState();
    };
    this.game.onControls = (controls) => {
      (Object.keys(controls) as Array<keyof DesktopControls>).forEach((key) => {
        this.input.controls[key] = controls[key];
      });
      this.renderControls(controls);
    };
    this.snapshot = this.game.session.snapshot();
    this.renderSnapshot();
  }

  private bindInput(): void {
    this.input.onChange = (controls) => {
      this.game.setControls(controls);
      this.renderControls(controls);
    };
    // Máy host luôn ném được (kể cả trong ván party) để không kẹt lượt khi một điện thoại rớt mạng.
    this.input.onPrepare = () => !this.lobbyOpen && this.game.prepare();
    this.input.onCancel = () => this.game.cancelPrepare();
    this.input.onThrow = (id, controls) => !this.lobbyOpen && this.game.throw(id, controls);
    this.input.onCharge = (power, active) => {
      const button = this.query<HTMLButtonElement>('[data-throw]');
      button.style.setProperty('--charge', `${Math.round(power * 100)}%`);
      button.classList.toggle('is-charging', active);
      button.querySelector('span')!.textContent = active ? `${Math.round(power * 100)}%` : 'GIỮ ĐỂ LẤY LỰC';
    };
  }

  private bindUi(): void {
    bindThemeToggle(this.root);
    this.root.querySelectorAll<HTMLButtonElement>('[data-players]').forEach((button) => {
      button.addEventListener('click', () => this.startLocal(Number(button.dataset.players)));
    });
    this.query<HTMLButtonElement>('[data-party-start]').addEventListener('click', () => this.startParty());
    this.query<HTMLButtonElement>('[data-restart]').addEventListener('click', () => this.restartGame());
    this.root.querySelectorAll<HTMLButtonElement>('[data-open-lobby]').forEach((button) => {
      button.addEventListener('click', () => this.openLobby());
    });

    const throwButton = this.query<HTMLButtonElement>('[data-throw]');
    throwButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      throwButton.setPointerCapture(event.pointerId);
      this.input.startCharge();
    });
    throwButton.addEventListener('pointerup', (event) => {
      event.preventDefault();
      this.input.releaseCharge();
    });
    throwButton.addEventListener('pointercancel', () => this.input.cancelCharge());
    throwButton.addEventListener('contextmenu', (event) => event.preventDefault());

    this.root.querySelectorAll<HTMLInputElement>('[data-control]').forEach((slider) => {
      slider.addEventListener('input', () => {
        const key = slider.dataset.control as keyof DesktopControls;
        this.input.setControl(key, Number(slider.value));
      });
    });

    this.query<HTMLButtonElement>('[data-phone-toggle]').addEventListener('click', () => {
      this.setPhonePanel(!this.phonePanelOpen);
    });
    this.query<HTMLButtonElement>('[data-phone-close]').addEventListener('click', () => this.setPhonePanel(false));
    this.query<HTMLButtonElement>('[data-diag-toggle]').addEventListener('click', () => {
      this.diagnosticsOpen = !this.diagnosticsOpen;
      this.query('[data-diagnostics]').classList.toggle('is-open', this.diagnosticsOpen);
    });
    this.query<HTMLInputElement>('[data-force-relay]').addEventListener('change', (event) => {
      this.network.setForceRelay((event.target as HTMLInputElement).checked);
    });
    this.query<HTMLButtonElement>('[data-sound]').addEventListener('click', (event) => {
      const muted = this.game.audio.toggle();
      (event.currentTarget as HTMLButtonElement).textContent = muted ? 'Âm thanh: Tắt' : 'Âm thanh: Bật';
    });
    this.query<HTMLButtonElement>('[data-effects]').addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const enabled = button.dataset.enabled !== 'true';
      button.dataset.enabled = String(enabled);
      button.textContent = enabled ? 'Hiệu ứng: Giảm' : 'Hiệu ứng: Đầy đủ';
      this.game.setReducedEffects(enabled);
    });
    this.query<HTMLButtonElement>('[data-quality]').addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const current = button.dataset.mode ?? 'auto';
      const next = current === 'auto' ? 'high' : current === 'high' ? 'low' : 'auto';
      button.dataset.mode = next;
      button.textContent = next === 'auto' ? 'Đồ họa: Tự động' : next === 'high' ? 'Đồ họa: Cao' : 'Đồ họa: Nhẹ';
      this.game.setQualityMode(next);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-camera-mode]').forEach((button) => {
      button.addEventListener('click', () => this.selectCamera(button.dataset.cameraMode as CameraMode));
    });
    window.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() !== 'v' || event.ctrlKey || event.metaKey || event.altKey) return;
      const current = CAMERA_MODES.findIndex(({ mode }) => mode === this.cameraMode);
      this.selectCamera(CAMERA_MODES[(current + 1) % CAMERA_MODES.length]!.mode);
    });
  }

  private startLocal(count: number): void {
    this.party.setLocal();
    this.game.restart(count);
    this.closeLobby();
  }

  private startParty(): CommandResult {
    const lineup = this.party.startParty();
    if (!lineup) return { accepted: false, reason: 'Chưa có điện thoại nào trong phòng' };
    this.game.restart(lineup);
    this.closeLobby();
    return { accepted: true };
  }

  private restartGame(): CommandResult {
    if (this.party.stage === 'party') return this.startParty();
    this.game.restart();
    this.closeLobby();
    return { accepted: true };
  }

  private openLobby(): void {
    this.party.backToLobby();
    this.lobbyOpen = true;
    this.input.cancelCharge();
    this.game.cancelPrepare();
    this.setPhonePanel(false);
    this.query('[data-end-overlay]').classList.add('is-hidden');
    this.query('[data-start-overlay]').classList.remove('is-hidden');
    this.syncParty();
  }

  private closeLobby(): void {
    this.lobbyOpen = false;
    this.lastTurnKey = '';
    this.query('[data-start-overlay]').classList.add('is-hidden');
    this.query('[data-end-overlay]').classList.add('is-hidden');
    this.renderSnapshot();
    this.syncParty();
  }

  private setPhonePanel(open: boolean): void {
    this.phonePanelOpen = open;
    this.query('[data-phone-panel]').classList.toggle('is-open', open);
  }

  private selectCamera(mode: CameraMode): void {
    const item = CAMERA_MODES.find((candidate) => candidate.mode === mode);
    if (!item) return;
    this.cameraMode = mode;
    this.game.setCameraMode(mode);
    this.root.querySelectorAll<HTMLButtonElement>('[data-camera-mode]').forEach((button) => {
      const active = button.dataset.cameraMode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const toast = this.query<HTMLElement>('[data-camera-toast]');
    toast.textContent = `Góc nhìn · ${item.label}`;
    toast.classList.remove('is-active');
    requestAnimationFrame(() => toast.classList.add('is-active'));
    window.clearTimeout(this.cameraToastTimer);
    this.cameraToastTimer = window.setTimeout(() => toast.classList.remove('is-active'), 1_400);
  }

  private async startNetwork(): Promise<void> {
    this.network.onRoom = (room) => {
      this.room = room;
      this.renderRoom();
    };
    this.network.onStats = (stats) => {
      this.lastStats = stats;
      this.renderNetwork();
    };
    this.network.onPeerOpen = (peer) => this.sendState(peer);
    this.network.onPeerClose = (peer) => {
      this.party.leave(peer);
      this.syncParty();
      this.renderSnapshot();
    };
    this.network.onCommand = (peer, command, receivedAt) => this.handleCommand(peer, command, receivedAt);
    try {
      await this.network.start();
    } catch (error) {
      this.lobby.renderOffline();
      this.lastStats = { ...this.lastStats, error: error instanceof Error ? error.message : String(error) };
      this.renderNetwork();
    }
  }

  private handleCommand(peer: string, command: PartyCommand | BowlingCommand, receivedAt: number): CommandResult | void {
    if (command.type === 'hello') {
      const result = this.party.join(peer, command.clientId, command.name);
      if (!result.member) {
        this.network.send(peer, { type: 'notice', message: result.reason });
      } else {
        const player = this.party.playerIndex(result.member.id);
        if (player !== null) this.game.renamePlayer(player, result.member.name);
      }
      this.syncParty();
      return;
    }

    const seat = this.party.seat(peer, this.snapshot.activePlayer);
    if (command.type === 'lobby') {
      if (!seat.leader) return { accepted: false, reason: 'Chỉ chủ phòng mới điều khiển được sảnh' };
      if (command.action === 'start') {
        return this.party.stage === 'lobby' ? this.startParty() : { accepted: false, reason: 'Ván đang diễn ra' };
      }
      return this.snapshot.phase === 'GAME_OVER' ? this.restartGame() : { accepted: false, reason: 'Ván chưa kết thúc' };
    }

    if (!seat.control) {
      return 'seq' in command ? { accepted: false, reason: this.turnReason() } : undefined;
    }
    this.network.setStatsFocus(peer);
    if (command.type === 'aim') {
      this.game.setControls({ aim: command.aim, spin: command.spin, position: command.position });
      return;
    }
    if (command.type === 'prepare') return { accepted: this.game.prepare() };
    if (command.type === 'cancel') {
      this.game.cancelPrepare();
      return { accepted: true };
    }
    if (command.type === 'throw') {
      const accepted = this.game.throw(command.seq, command);
      if (accepted) requestAnimationFrame(() => this.network.setInputToVisualLatency(performance.now() - receivedAt));
      return { accepted, reason: accepted ? undefined : 'Lượt ném đang bận' };
    }
  }

  private turnReason(): string {
    if (this.party.stage === 'lobby') return 'Ván chưa bắt đầu';
    const active = this.snapshot.players[this.snapshot.activePlayer];
    return active ? `Đang là lượt của ${active.name}` : 'Chưa đến lượt bạn';
  }

  /** Bảng chẩn đoán theo điện thoại của người đang tới lượt. */
  private focusActivePhone(): void {
    const owner = this.party.stage === 'party' ? this.party.ownerOf(this.snapshot.activePlayer) : undefined;
    if (owner?.peer) this.network.setStatsFocus(owner.peer);
  }

  private syncParty(): void {
    this.renderParty();
    this.broadcastState();
  }

  private broadcastState(): void {
    this.network.openPeers.forEach((peer) => this.sendState(peer));
  }

  private sendState(peer: string): void {
    this.network.send(peer, {
      type: 'view',
      view: this.snapshot,
      party: this.party.state(),
      seat: this.party.seat(peer, this.snapshot.activePlayer),
    });
  }

  private renderParty(): void {
    this.lobby.renderParty(this.party.state());
  }

  private renderSnapshot(): void {
    this.query('[data-status]').textContent = this.snapshot.message;
    const active = this.snapshot.players[this.snapshot.activePlayer];
    const nameElement = this.query('[data-player-name]');
    nameElement.textContent = active?.name ?? 'Bạn';
    if (this.snapshot.players.length > 1 && active) nameElement.style.setProperty('--player-color', active.color);
    else nameElement.style.removeProperty('--player-color');
    const owner = this.party.stage === 'party' ? this.party.ownerOf(this.snapshot.activePlayer) : undefined;
    const offline = owner && !owner.peer ? ' · điện thoại mất kết nối, ném bằng máy này' : '';
    this.query('[data-frame-label]').textContent = `Frame ${Math.min(10, (active?.frameIndex ?? 0) + 1)} · ${this.snapshot.standingPins} chai còn lại${offline}`;
    this.query<HTMLButtonElement>('[data-throw]').disabled = !this.snapshot.canThrow;
    this.renderScoreboard();
    this.renderTurnBanner();

    const result = this.snapshot.lastResult;
    const flash = this.query('[data-result-flash]');
    const resultKey = result
      ? `${this.snapshot.activePlayer}-${this.snapshot.players.map((player) => player.frames.reduce((sum, frame) => sum + frame.rolls.length, 0)).join('-')}-${result.label}`
      : '';
    if (result && resultKey !== this.lastResultKey) {
      this.lastResultKey = resultKey;
      const special = result.label === 'STRIKE!' || result.label === 'SPARE!';
      flash.textContent = special ? result.label : result.pins === 0 ? 'GUTTER!' : `${result.pins} CHAI`;
      flash.classList.toggle('is-special', special);
      flash.classList.toggle('is-regular', !special);
      flash.classList.remove('is-active');
      requestAnimationFrame(() => flash.classList.add('is-active'));
    }
    if (this.snapshot.phase === 'GAME_OVER' && !this.lobbyOpen) {
      this.query('[data-end-title]').textContent = this.snapshot.message;
      this.renderRanking();
      this.query('[data-end-overlay]').classList.remove('is-hidden');
    }
  }

  /** Nhiều người chơi: hiện tên người tới lượt thật to để cả phòng nhìn thấy từ xa. */
  private renderTurnBanner(): void {
    const { players, activePlayer, phase } = this.snapshot;
    const active = players[activePlayer];
    if (this.lobbyOpen || players.length < 2 || phase !== 'AIMING' || !active) return;
    const key = `${activePlayer}-${active.frameIndex}`;
    if (key === this.lastTurnKey) return;
    this.lastTurnKey = key;
    const banner = this.query<HTMLElement>('[data-turn-banner]');
    banner.style.setProperty('--player-color', active.color);
    this.query('[data-turn-name]').textContent = active.name;
    banner.classList.remove('is-active');
    requestAnimationFrame(() => banner.classList.add('is-active'));
    window.clearTimeout(this.turnBannerTimer);
    this.turnBannerTimer = window.setTimeout(() => banner.classList.remove('is-active'), 1_900);
  }

  private renderScoreboard(): void {
    const board = this.query('[data-scoreboard]');
    board.classList.toggle('is-compact', this.snapshot.players.length > 2);
    board.innerHTML = this.snapshot.players.map((player, playerIndex) => {
      const score = scoreFrames(player.frames);
      const running = score.cumulative.reduce<number | null>((last, value) => value ?? last, null);
      const frames = player.frames.map((frame, frameIndex) => {
        const marks = rollMarks(frame, frameIndex).join(' ');
        const cumulative = score.cumulative[frameIndex];
        return `<div class="score-frame ${playerIndex === this.snapshot.activePlayer && frameIndex === player.frameIndex ? 'is-current' : ''}">
          <small>${frameIndex + 1}</small><span>${marks || '·'}</span><strong>${cumulative ?? ''}</strong>
        </div>`;
      }).join('');
      return `<div class="score-row ${playerIndex === this.snapshot.activePlayer ? 'is-active' : ''}" style="--player-color: ${player.color}">
        <div class="score-player"><i></i><span>${escapeHtml(player.name)}</span></div>${frames}<div class="score-total">${running ?? 0}</div>
      </div>`;
    }).join('');
  }

  private renderRanking(): void {
    const ranked = [...this.snapshot.players].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    const list = this.query('[data-final-ranking]');
    list.classList.toggle('is-hidden', ranked.length < 2);
    list.innerHTML = ranked.map((player, index) => `<li style="--player-color: ${player.color}">
      <b>${index + 1}</b><i>${escapeHtml(initials(player.name))}</i><span>${escapeHtml(player.name)}</span><strong>${player.total ?? 0}</strong>
    </li>`).join('');
  }

  private renderControls(controls: DesktopControls): void {
    (Object.keys(controls) as Array<keyof DesktopControls>).forEach((key) => {
      const slider = this.root.querySelector<HTMLInputElement>(`[data-control="${key}"]`);
      if (slider) slider.value = String(controls[key]);
      const value = this.root.querySelector(`[data-value="${key}"]`);
      if (value) value.textContent = key === 'power'
        ? `${Math.round(controls[key] * 100)}%`
        : `${controls[key] >= 0 ? '+' : ''}${Math.round(controls[key] * 100)}`;
    });
  }

  private renderRoom(): void {
    this.lobby.renderRoom(this.room);
  }

  private renderNetwork(): void {
    const stats = this.lastStats;
    this.query('[data-connection-pill]').textContent = stats.controllers > 0
      ? `${stats.controllers} điện thoại`
      : stats.signaling === 'đã kết nối' ? 'Chờ điện thoại' : stats.signaling;
    this.query('[data-connection-pill]').classList.toggle('is-online', stats.controllers > 0);
    const fields: Record<string, string> = {
      signaling: stats.signaling,
      phones: String(stats.controllers),
      ice: stats.ice,
      control: stats.control,
      telemetry: stats.telemetry,
      route: stats.route === 'relay' ? 'TURN relay' : stats.route === 'direct' ? 'Trực tiếp' : 'Chưa biết',
      candidates: `${stats.localCandidate} ↔ ${stats.remoteCandidate}`,
      rtt: stats.rttMs == null ? '—' : `${stats.rttMs.toFixed(1)} ms`,
      visual: stats.inputToVisualMs == null ? '—' : `${stats.inputToVisualMs.toFixed(1)} ms`,
      traffic: `${this.formatBytes(stats.bytesSent)} ↑ / ${this.formatBytes(stats.bytesReceived)} ↓`,
      error: stats.error || 'Không có',
    };
    Object.entries(fields).forEach(([key, value]) => {
      const element = this.root.querySelector(`[data-net="${key}"]`);
      if (element) element.textContent = value;
    });
  }

  private formatBytes(value: number): string {
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 ** 2).toFixed(1)} MB`;
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Thiếu phần tử UI: ${selector}`);
    return element;
  }

  private template(): string {
    return `
      <main class="desktop-shell">
        <section class="game-stage" data-game-stage aria-label="Sân bowling 3D"></section>
        <div class="vignette" aria-hidden="true"></div>
        <header class="topbar">
          <div class="brand-lockup"><div class="brand-ball"><i></i><i></i><i></i></div><div><strong>POCKET</strong><span>BOWLING</span></div></div>
          <div class="game-readout"><span data-player-name>Bạn</span><strong data-status>Chỉnh hướng, lực và độ xoáy</strong><small data-frame-label>Frame 1 · 10 chai còn lại</small></div>
          <div class="top-actions">
            <a class="icon-button hub-home-button" href="${arcadeUrl()}" aria-label="Về kho game">⌂ <span>Kho game</span></a>
            <button class="icon-button theme-toggle" data-theme-toggle type="button"><span data-theme-icon aria-hidden="true">☀</span><span data-theme-label>Chế độ sáng</span></button>
            <span class="connection-pill" data-connection-pill>đang kết nối</span>
            <button class="icon-button" data-phone-toggle aria-label="Người chơi và mã QR">▣ <span>Người chơi</span></button>
            <button class="icon-button" data-diag-toggle aria-label="Mở chẩn đoán">⌁ <span>Mạng</span></button>
          </div>
        </header>

        <section class="scoreboard glass" data-scoreboard aria-label="Bảng điểm"></section>
        <div class="result-flash" data-result-flash aria-live="polite"></div>
        <div class="turn-banner" data-turn-banner aria-live="polite"><span>ĐẾN LƯỢT</span><strong data-turn-name></strong></div>
        <div class="camera-toast glass" data-camera-toast aria-live="polite"></div>

        <nav class="camera-switcher glass" aria-label="Chọn góc nhìn">
          <span class="camera-switcher-label">GÓC NHÌN <kbd>V</kbd></span>
          <button class="is-active" data-camera-mode="dynamic" aria-pressed="true" title="Camera tự động"><span>A</span><b>Tự động</b></button>
          <button data-camera-mode="chase" aria-pressed="false" title="Theo sát bóng"><span>→</span><b>Theo bóng</b></button>
          <button data-camera-mode="side" aria-pressed="false" title="Nhìn ngang sân"><span>↔</span><b>Ngang sân</b></button>
          <button data-camera-mode="pins" aria-pressed="false" title="Nhìn từ sau dàn chai"><span>●</span><b>Sau chai</b></button>
          <button data-camera-mode="top" aria-pressed="false" title="Nhìn từ trên cao"><span>⌃</span><b>Trên cao</b></button>
        </nav>

        <section class="control-dock glass" aria-label="Điều khiển ném">
          <label><span>VỊ TRÍ <b data-value="position">+0</b></span><input data-control="position" type="range" min="-1" max="1" value="0" step="0.01"></label>
          <label><span>HƯỚNG <b data-value="aim">+0</b></span><input data-control="aim" type="range" min="-1" max="1" value="0" step="0.01"></label>
          <button class="throw-button" data-throw style="--charge: 68%"><em></em><span>GIỮ ĐỂ LẤY LỰC</span><small>Space / giữ chuột</small></button>
          <label><span>ĐỘ XOÁY <b data-value="spin">+0</b></span><input data-control="spin" type="range" min="-1" max="1" value="0" step="0.01"></label>
          <label><span>LỰC <b data-value="power">68%</b></span><input data-control="power" type="range" min="0.2" max="1" value="0.68" step="0.01"></label>
        </section>

        <div class="keyboard-hint">A / D vị trí · Q / E hướng · Z / C xoáy · W / S lực · V đổi góc nhìn</div>

        ${HostLobby.panelHtml()}

        <aside class="side-panel diagnostics glass" data-diagnostics>
          <span class="eyebrow">NETWORK LAB</span><h2>Chẩn đoán kết nối</h2>
          <dl>
            <div><dt>Signaling</dt><dd data-net="signaling">—</dd></div>
            <div><dt>Điện thoại đang nối</dt><dd data-net="phones">0</dd></div>
            <div><dt>ICE</dt><dd data-net="ice">—</dd></div>
            <div><dt>DataChannel lệnh</dt><dd data-net="control">—</dd></div>
            <div><dt>Telemetry</dt><dd data-net="telemetry">—</dd></div>
            <div><dt>Đường truyền</dt><dd data-net="route">—</dd></div>
            <div><dt>Candidate</dt><dd data-net="candidates">—</dd></div>
            <div><dt>RTT kết nối</dt><dd data-net="rtt">—</dd></div>
            <div><dt>Input → hình ảnh</dt><dd data-net="visual">—</dd></div>
            <div><dt>Dữ liệu ICE pair</dt><dd data-net="traffic">—</dd></div>
            <div><dt>Lỗi gần nhất</dt><dd data-net="error">Không có</dd></div>
          </dl>
          <p class="security-note">Số liệu ICE theo điện thoại của người đang tới lượt.</p>
          <label class="switch-row"><span><b>Ép TURN relay</b><small>Tạo lại PeerConnection để kiểm thử</small></span><input type="checkbox" data-force-relay><i></i></label>
        </aside>

        <nav class="settings-strip glass">
          <button data-sound>Âm thanh: Bật</button><button data-effects>Hiệu ứng: Đầy đủ</button><button data-quality data-mode="auto">Đồ họa: Tự động</button>
        </nav>

        ${HostLobby.overlayHtml({
          eyebrow: 'SÂN 01 · ARCADE',
          localTitle: 'Chơi trên máy này',
          localCopy: 'Dùng bàn phím, chuột hoặc một điện thoại làm tay cầm chung cho mọi người.',
          localHint: 'Giữ <kbd>Space</kbd> để lấy lực, thả để ném',
          players: meta.players,
        })}

        <section class="modal-overlay is-hidden" data-end-overlay>
          <div class="mode-card glass"><span class="eyebrow">KẾT QUẢ CUỐI VÁN</span><h1 data-end-title>Hoàn tất!</h1>
            <ol class="final-ranking" data-final-ranking></ol>
            <div class="end-actions"><button class="primary-button" data-restart>CHƠI LẠI</button><button class="ghost-button" data-open-lobby>VỀ SẢNH CHỜ</button></div>
          </div>
        </section>
      </main>`;
  }
}
