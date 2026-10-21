import {
  arcadeUrl, bindThemeToggle, defaultPlayers, escapeHtml, getTheme, HostLobby, initials, onThemeChange, PartyRoom, PLAYER_COLORS,
  uiIcon, WebRTCHost, type CommandResult, type NetworkStats, type PartyCommand,
} from '@pocket/party-kit';
import { LEVELS } from './levels';
import { meta } from './meta';
import { parseRollCommand, type BuzzKind, type RollBuzz, type RollCommand } from './protocol';
import { RollAudio } from './RollAudio';
import { RollMatch, type MatchEvent, type RollerSetup } from './RollMatch';
import { RollRenderer, type RollViewMode } from './RollRenderer';

const BROADCAST_MS = 120;
/** Không nhận độ nghiêng mới quá lâu (điện thoại khóa màn hình) thì coi như cầm thẳng. */
const STALE_INPUT_MS = 600;
const LEVEL_KEY = 'pocket-roll-level';
const CLEARED_KEY = 'pocket-roll-cleared';
const VIEW_KEY = 'pocket-roll-view';
/** Chiều rộng sảnh chờ thu gọn bên trái (khớp CSS .is-docked .lobby-card). */
const DOCKED_LOBBY_WIDTH = 470;

/** Bàn phím cho chế độ chơi trên máy này: P1 ← → nghiêng, ↑/Space nhảy; P2 A/D, W. */
const KEYMAP: Array<{ left: string; right: string; jump: string[] }> = [
  { left: 'ArrowLeft', right: 'ArrowRight', jump: ['ArrowUp', 'Space'] },
  { left: 'KeyA', right: 'KeyD', jump: ['KeyW'] },
];

/** Chế độ hiển thị TV chọn; 'auto' quyết theo số người lúc vào trận. */
type ViewSetting = 'auto' | RollViewMode;

const VIEW_OPTIONS: Array<{ id: ViewSetting; label: string; hint: string }> = [
  { id: 'auto', label: 'Tự động', hint: '2 người thì mỗi người một sân, đông hơn thì chung một sân.' },
  { id: 'shared', label: 'Sân chung', hint: 'Mọi người chung một khung, thấy và va vào nhau.' },
  { id: 'split', label: 'Chia màn hình', hint: 'Mỗi người một khung bám theo mình, vẫn thấy người khác.' },
  { id: 'solo', label: 'Mỗi người một sân', hint: 'Mỗi khung chỉ có mình bạn: không va nhau, bập bênh riêng.' },
];

function loadView(): ViewSetting {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    return VIEW_OPTIONS.some((option) => option.id === value) ? value as ViewSetting : 'auto';
  } catch {
    return 'auto';
  }
}

function loadNumber(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function loadCleared(): Set<number> {
  try {
    const values = JSON.parse(localStorage.getItem(CLEARED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(values) ? values.filter((value): value is number => Number.isInteger(value)) : []);
  } catch {
    return new Set();
  }
}

export class RollApp {
  private readonly network = new WebRTCHost(parseRollCommand);
  private readonly party = new PartyRoom(meta.players.max);
  private readonly lobby: HostLobby;
  private readonly renderer: RollRenderer;
  private readonly audio = new RollAudio();
  private match: RollMatch | null = null;
  private selectedLevel = Math.min(LEVELS.length - 1, loadNumber(LEVEL_KEY, 0));
  private viewSetting = loadView();
  private readonly cleared = loadCleared();
  /** Sàn khởi động ở sảnh: ai quét mã là có cuộn giấy lăn thử ngay màn đang chọn. */
  private readonly practice = new RollMatch([], { practice: true, level: this.selectedLevel });
  private humans = 0;
  private lobbyOpen = true;
  private phonePanelOpen = false;
  private lastFrame = performance.now();
  private lastBroadcast = 0;
  private lastRoster = '';
  private lastOverlay = '';
  private readonly keys = new Set<string>();
  private readonly keyboardTilt = KEYMAP.map(() => 0);
  private readonly lastSeq = new Map<string, number>();
  private readonly lastInputAt = new Map<string, number>();
  private readonly touching = new Map<string, boolean>();

  constructor(private readonly root: HTMLElement) {
    document.title = 'Roll';
    this.root.innerHTML = this.template();
    this.lobby = new HostLobby(this.root);
    this.renderer = new RollRenderer(this.query('[data-roll-stage]'));
    this.renderer.setTheme(getTheme());
    onThemeChange((theme) => this.renderer.setTheme(theme));
    this.bindUi();
    this.renderLevelPicker();
    this.renderViewPicker();
    this.syncPractice();
    this.renderParty();
    this.layout();
    window.addEventListener('resize', () => this.layout());
    requestAnimationFrame(this.frame);
    void this.startNetwork();
  }

  private bindUi(): void {
    bindThemeToggle(this.root);
    this.root.querySelectorAll<HTMLButtonElement>('[data-players]').forEach((button) => {
      button.addEventListener('click', () => this.startLocal(Number(button.dataset.players)));
    });
    this.query<HTMLButtonElement>('[data-party-start]').addEventListener('click', () => this.startParty());
    this.query('[data-level-grid]').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-level]');
      if (button) this.selectLevel(Number(button.dataset.level));
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-open-lobby]').forEach((button) => {
      button.addEventListener('click', () => this.openLobby());
    });
    this.query('[data-view-options]').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-view]');
      if (button) this.selectView(button.dataset.view as ViewSetting);
    });
    this.query<HTMLButtonElement>('[data-view-cycle]').addEventListener('click', () => {
      const index = VIEW_OPTIONS.findIndex((option) => option.id === this.viewSetting);
      this.selectView(VIEW_OPTIONS[(index + 1) % VIEW_OPTIONS.length]!.id);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-level-action]').forEach((button) => {
      button.addEventListener('click', () => this.levelAction(button.dataset.levelAction as 'next' | 'retry' | 'again'));
    });
    this.query<HTMLButtonElement>('[data-phone-toggle]').addEventListener('click', () => this.setPhonePanel(!this.phonePanelOpen));
    this.query<HTMLButtonElement>('[data-phone-close]').addEventListener('click', () => this.setPhonePanel(false));
    this.query<HTMLButtonElement>('[data-sound]').addEventListener('click', (event) => {
      const muted = this.audio.toggle();
      (event.currentTarget as HTMLButtonElement).textContent = muted ? 'Âm thanh: Tắt' : 'Âm thanh: Bật';
    });
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement) return;
      const local = this.party.stage === 'local' && !this.lobbyOpen && this.match;
      const players = KEYMAP.slice(0, this.humans);
      if (local) {
        players.forEach((keys, index) => {
          if (keys.jump.includes(event.code) && !event.repeat) this.match!.jump(`local-${index + 1}`);
        });
        if (players.some((keys) => [keys.left, keys.right, ...keys.jump].includes(event.code))) event.preventDefault();
      }
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private selectLevel(index: number): void {
    this.selectedLevel = Math.max(0, Math.min(LEVELS.length - 1, index));
    try {
      localStorage.setItem(LEVEL_KEY, String(this.selectedLevel));
    } catch {
      // Chỉ mất việc nhớ màn đã chọn.
    }
    this.practice.setPracticeLevel(this.selectedLevel);
    this.renderer.reset();
    this.renderLevelPicker();
    this.broadcast();
  }

  private renderLevelPicker(): void {
    this.query('[data-level-grid]').innerHTML = LEVELS.map((level, index) => `<button type="button" data-level="${index}" class="${index === this.selectedLevel ? 'is-active' : ''} ${this.cleared.has(index) ? 'is-cleared' : ''}" aria-pressed="${index === this.selectedLevel}">
      <b>${index + 1}</b><span>${escapeHtml(level.name)}</span>
    </button>`).join('');
    this.query('[data-level-picked]').textContent = `Màn ${this.selectedLevel + 1} · ${LEVELS[this.selectedLevel]!.name}`;
  }

  private selectView(setting: ViewSetting): void {
    this.viewSetting = setting;
    try {
      localStorage.setItem(VIEW_KEY, setting);
    } catch {
      // Chỉ mất việc nhớ lựa chọn cho lần sau.
    }
    this.renderViewPicker();
  }

  private renderViewPicker(): void {
    const selected = VIEW_OPTIONS.find((option) => option.id === this.viewSetting)!;
    this.root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
      const active = button.dataset.view === selected.id;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    this.query('[data-view-hint]').textContent = selected.hint;
    this.query('[data-view-cycle]').textContent = `Hiển thị: ${selected.label}`;
  }

  /** Chế độ thực sự dùng: sàn khởi động ở sảnh luôn là sân chung; chia màn hình cần từ hai người chơi thật. */
  private viewFor(match: RollMatch): RollViewMode {
    if (match.practice) return 'shared';
    const humans = match.rollers.filter((roller) => !roller.bot).length;
    if (this.viewSetting === 'auto') return humans === 2 ? 'solo' : 'shared';
    return humans >= 2 ? this.viewSetting : 'shared';
  }

  private startLocal(count: number): void {
    this.party.setLocal();
    this.humans = count;
    this.beginMatch(defaultPlayers(count).map((player, index) => ({ ...player, key: `local-${index + 1}` })));
  }

  private startParty(): CommandResult {
    const lineup = this.party.startParty();
    if (!lineup) return { accepted: false, reason: 'Chưa có điện thoại nào trong phòng' };
    this.humans = lineup.length;
    this.beginMatch(this.party.state().members.map((member) => ({ key: member.id, name: member.name, color: member.color })));
    return { accepted: true };
  }

  private beginMatch(lineup: RollerSetup[], level = this.selectedLevel): void {
    this.match = new RollMatch(lineup, { level });
    this.renderer.reset();
    this.lastInputAt.clear();
    this.keyboardTilt.fill(0);
    this.lobbyOpen = false;
    this.query('[data-start-overlay]').classList.add('is-hidden');
    this.setPhonePanel(false);
    this.layout();
    this.syncParty();
  }

  /** Nút ở bảng kết quả màn (TV hoặc chủ phòng): màn tiếp, chơi lại màn, hoặc chơi lại cả trận. */
  private levelAction(action: 'next' | 'retry' | 'again'): CommandResult {
    const match = this.match;
    if (!match) return { accepted: false, reason: 'Chưa có trận nào' };
    if (action === 'again') {
      if (match.phase !== 'matchEnd') return { accepted: false, reason: 'Trận chưa kết thúc' };
      if (this.party.stage === 'party') return this.startParty();
      this.beginMatch(match.rollers.map(({ key, name, color }) => ({ key, name, color })), 0);
      return { accepted: true };
    }
    return match.goTo(action === 'next' ? 'next' : 'retry') ? { accepted: true } : { accepted: false, reason: 'Chưa xem kết quả màn' };
  }

  private openLobby(): void {
    this.party.backToLobby();
    this.match = null;
    this.lobbyOpen = true;
    this.renderer.reset();
    this.setPhonePanel(false);
    this.query('[data-start-overlay]').classList.remove('is-hidden');
    this.layout();
    this.syncParty();
  }

  private setPhonePanel(open: boolean): void {
    this.phonePanelOpen = open;
    this.query('[data-phone-panel]').classList.toggle('is-open', open);
  }

  /** Sảnh chờ thu gọn bên trái để thấy sàn khởi động; màn hình hẹp thì sảnh phủ kín như các game khác. */
  private layout(): void {
    const docked = this.lobbyOpen && window.innerWidth > 1_000;
    this.query('.roll-shell').classList.toggle('is-docked', docked);
    this.renderer.setInset(docked ? DOCKED_LOBBY_WIDTH + 24 : 0);
  }

  private get active(): RollMatch {
    return this.match ?? this.practice;
  }

  private readonly frame = (now: number): void => {
    const elapsed = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const active = this.active;
    const view = this.viewFor(active);
    active.setSeparate(view === 'solo');
    this.renderer.setViewMode(view);
    // Chia màn hình thì mỗi khung có nhãn riêng: ẩn dải người chơi dưới đáy cho khung cao hơn.
    this.query('[data-roller-roster]').classList.toggle('is-split', view !== 'shared');
    this.applyInputs(active, now, elapsed);
    active.advance(elapsed).forEach((event) => this.handleEvent(active, event, now));
    this.renderer.render(active, now, elapsed);
    if (now - this.lastBroadcast > BROADCAST_MS) {
      this.lastBroadcast = now;
      this.renderHud(active);
      this.broadcast();
    }
    requestAnimationFrame(this.frame);
  };

  private applyInputs(active: RollMatch, now: number, elapsed: number): void {
    if (this.party.stage === 'local' && this.match) {
      KEYMAP.slice(0, this.humans).forEach((keys, index) => {
        const target = (this.keys.has(keys.right) ? 1 : 0) - (this.keys.has(keys.left) ? 1 : 0);
        this.keyboardTilt[index]! += (target - this.keyboardTilt[index]!) * Math.min(1, elapsed * 8);
        this.match!.setTilt(`local-${index + 1}`, this.keyboardTilt[index]!);
      });
      return;
    }
    for (const roller of active.rollers) {
      if (!roller.bot && now - (this.lastInputAt.get(roller.key) ?? 0) > STALE_INPUT_MS) active.setTilt(roller.key, 0);
    }
  }

  private handleEvent(match: RollMatch, entry: MatchEvent, now: number): void {
    // Sảnh chỉ có bot chạy nền thì im lặng, có người khởi động mới phát tiếng.
    if (!match.practice || match.rollers.some((roller) => !roller.bot)) this.audio.event(entry);
    this.renderer.effect(match, entry, now);
    const event = entry.event;
    if (entry.roller >= 0) {
      const key = match.rollers[entry.roller]?.key;
      if (!key) return;
      if (event.type === 'die') this.buzz(key, 'die', 1);
      else if (event.type === 'checkpoint') this.buzz(key, 'checkpoint', 0.5);
      else if (event.type === 'goal') this.buzz(key, 'goal', 1);
      else if (event.type === 'land' && event.strength > 0.6) this.buzz(key, 'land', event.strength);
      return;
    }
    if (event.type === 'tick' || event.type === 'go') this.showBanner(match, event.type === 'go' ? 'LĂN!' : String(event.value));
    if (event.type === 'levelEnd' && event.cleared) this.markCleared(match.levelIndex);
    this.broadcast();
  }

  private markCleared(index: number): void {
    this.cleared.add(index);
    try {
      localStorage.setItem(CLEARED_KEY, JSON.stringify([...this.cleared]));
    } catch {
      // Chỉ mất dấu ✓ ở màn đã qua.
    }
    this.renderLevelPicker();
  }

  private showBanner(match: RollMatch, countdown: string): void {
    const banner = this.query('[data-banner]');
    this.query('[data-banner-kicker]').textContent = `MÀN ${match.levelIndex + 1}/${LEVELS.length} · ${match.level.name.toUpperCase()}`;
    this.query('[data-banner-title]').textContent = countdown;
    this.query('[data-banner-sub]').textContent = match.level.hint;
    banner.classList.remove('is-active', 'is-count');
    void banner.offsetWidth;
    banner.classList.add('is-active', 'is-count');
  }

  private renderHud(active: RollMatch): void {
    const view = active.view();
    const readout = this.query('[data-readout]');
    const hint = this.query('[data-readout-hint]');
    readout.textContent = active.practice ? `Lăn thử · Màn ${view.levelIndex + 1}` : `Màn ${view.levelIndex + 1}/${view.levelCount} · ${view.levelName}`;
    hint.textContent = active.practice
      ? 'Quét QR là có cuộn giấy · nghiêng để lăn · hất máy để nhảy'
      : view.graceLeft !== null ? `Còn ${Math.ceil(view.graceLeft)} giây để giao giấy!` : view.hint;

    const roster = active.practice ? '' : this.rosterHtml(active);
    if (roster !== this.lastRoster) {
      this.lastRoster = roster;
      const element = this.query('[data-roller-roster]');
      element.innerHTML = roster;
      element.classList.toggle('is-hidden', !roster);
      element.classList.toggle('is-crowded', active.rollers.length > 5);
    }
    this.renderOverlay(active);
  }

  private rosterHtml(match: RollMatch): string {
    const party = this.party.state();
    return match.rollers.map((roller) => {
      const member = party.members.find((entry) => entry.id === roller.key);
      const roll = roller.roll;
      const status = member && !member.connected ? 'MẤT KẾT NỐI'
        : roll.status === 'done' ? `ĐÃ GIAO · ${roll.finishTime!.toFixed(1)}s`
          : roll.status === 'dead' ? 'RÁCH GIẤY…' : 'ĐANG LĂN';
      return `<li class="player-card is-${roll.status === 'done' ? 'done' : roll.status === 'dead' ? 'falling' : 'alive'} ${member && !member.connected ? 'is-offline' : ''}" style="--player-color: ${roller.color}">
        <span class="player-avatar">${escapeHtml(initials(roller.name))}</span>
        <span class="player-copy"><strong>${escapeHtml(roller.name)}</strong><small>${status}</small></span>
        <span class="player-score"><b class="roll-points">${roller.points} đ</b><small>× ${roll.deaths}</small></span>
      </li>`;
    }).join('');
  }

  /** Bảng kết quả màn / cả trận, vẽ lại khi nội dung đổi. */
  private renderOverlay(match: RollMatch): void {
    const overlay = this.query('[data-level-overlay]');
    const view = match.view();
    const show = view.phase === 'levelEnd' || view.phase === 'matchEnd';
    overlay.classList.toggle('is-hidden', !show);
    if (!show) {
      this.lastOverlay = '';
      return;
    }
    const final = view.phase === 'matchEnd';
    const rows = view.ranking.map((key, index) => {
      const roller = view.rollers.find((entry) => entry.key === key)!;
      const detail = final
        ? `chết ${match.roller(key)?.totalDeaths ?? 0} lần cả trận`
        : roller.finishTime !== null ? `giao trong ${roller.finishTime.toFixed(1)}s · chết ${roller.deaths}` : `chưa tới đích · chết ${roller.deaths}`;
      const score = final ? `${roller.points} đ` : roller.levelPoints ? `+${roller.levelPoints}` : '—';
      return `<li style="--player-color: ${roller.color}"><b>${index + 1}</b><i>${escapeHtml(initials(roller.name))}</i><span>${escapeHtml(roller.name)}<small>${detail}</small></span><strong>${score}</strong></li>`;
    }).join('');
    const title = final ? `${view.rollers.find((entry) => entry.key === view.ranking[0])?.name ?? ''} vô địch!`
      : view.cleared ? `Qua màn ${view.levelIndex + 1}!` : 'Chưa ai giao được giấy';
    const eyebrow = final ? `HẾT ${view.levelCount} MÀN · TỔNG ĐIỂM` : `MÀN ${view.levelIndex + 1} · ${view.levelName.toUpperCase()}`;
    const next = final ? '' : view.cleared && view.levelIndex < view.levelCount - 1
      ? `Tự sang màn ${view.levelIndex + 2} sau ${Math.ceil(view.nextIn ?? 0)} giây`
      : `Tự chơi lại màn này sau ${Math.ceil(view.nextIn ?? 0)} giây`;
    const key = [title, eyebrow, rows, next].join('|');
    if (key === this.lastOverlay) return;
    this.lastOverlay = key;
    this.query('[data-level-eyebrow]').textContent = eyebrow;
    this.query('[data-level-title]').textContent = title;
    this.query('[data-level-ranking]').innerHTML = rows;
    this.query('[data-level-next]').textContent = next;
    this.query('[data-level-action="next"]').classList.toggle('is-hidden', final || !view.cleared || view.levelIndex >= view.levelCount - 1);
    this.query('[data-level-action="retry"]').classList.toggle('is-hidden', final);
    this.query('[data-level-action="again"]').classList.toggle('is-hidden', !final);
  }

  /** Sàn khởi động gồm mọi điện thoại đang kết nối; phòng trống thì một bot lăn mẫu. */
  private syncPractice(): void {
    const members = this.party.state().members.filter((member) => member.connected);
    const keep = new Set(members.map((member) => member.id));
    if (!members.length) keep.add('demo-bot');
    [...this.practice.rollers].filter((roller) => !keep.has(roller.key)).forEach((roller) => this.practice.removeRoller(roller.key));
    members.forEach((member) => this.practice.addRoller({ key: member.id, name: member.name, color: member.color }));
    if (!members.length) this.practice.addRoller({ key: 'demo-bot', name: 'Bot Giấy', color: PLAYER_COLORS[1], bot: true });
  }

  private async startNetwork(): Promise<void> {
    this.network.onRoom = (room) => this.lobby.renderRoom(room);
    this.network.onStats = (stats) => this.renderConnection(stats);
    this.network.onPeerOpen = () => this.broadcast();
    this.network.onPeerClose = (peer) => {
      this.party.leave(peer);
      this.lastSeq.delete(peer);
      this.touching.delete(peer);
      this.syncParty();
    };
    this.network.onCommand = (peer, command) => this.handleCommand(peer, command);
    this.network.onTelemetry = (peer, sample) => {
      const member = this.party.memberByPeer(peer);
      if (!member || typeof sample.seq !== 'number' || typeof sample.tilt !== 'number') return;
      // Kênh telemetry không đảm bảo thứ tự: bỏ mẫu cũ hơn mẫu đã dùng.
      if (sample.seq <= (this.lastSeq.get(peer) ?? -1)) return;
      this.lastSeq.set(peer, sample.seq);
      const match = this.matchFor(member.id);
      if (!match) return;
      match.setTilt(member.id, sample.tilt);
      const touching = sample.touch === 1;
      if (touching && !this.touching.get(peer)) match.touch(member.id);
      this.touching.set(peer, touching);
      this.lastInputAt.set(member.id, performance.now());
    };
    try {
      await this.network.start();
    } catch {
      this.lobby.renderOffline();
    }
  }

  /** Trận mà điện thoại này đang điều khiển: trận party nếu có ghế, sàn khởi động nếu đang ở sảnh. */
  private matchFor(memberId: string): RollMatch | null {
    if (this.party.stage === 'party' && this.match?.roller(memberId)) return this.match;
    if (this.lobbyOpen && this.practice.roller(memberId)) return this.practice;
    return null;
  }

  private handleCommand(peer: string, command: PartyCommand | RollCommand): CommandResult | void {
    if (command.type === 'hello') {
      const result = this.party.join(peer, command.clientId, command.name);
      if (!result.member) {
        this.network.send(peer, { type: 'notice', message: result.reason });
      } else {
        const roller = this.match?.roller(result.member.id);
        if (roller) roller.name = result.member.name;
      }
      this.syncParty();
      return;
    }
    const seat = this.party.seat(peer, -1);
    if (command.type === 'lobby') {
      if (!seat.leader) return { accepted: false, reason: 'Chỉ chủ phòng mới điều khiển được sảnh' };
      if (command.action === 'start') {
        return this.party.stage === 'lobby' ? this.startParty() : { accepted: false, reason: 'Đang chơi rồi' };
      }
      if (command.action === 'next') return this.levelAction('next');
      return this.levelAction(this.match?.phase === 'matchEnd' ? 'again' : 'retry');
    }
    if (command.type === 'jump') {
      const member = this.party.memberByPeer(peer);
      const match = member ? this.matchFor(member.id) : null;
      if (!member || !match) return { accepted: false };
      return { accepted: match.jump(member.id) };
    }
  }

  private syncParty(): void {
    if (this.lobbyOpen) this.syncPractice();
    this.renderParty();
    this.broadcast();
  }

  private renderParty(): void {
    this.lobby.renderParty(this.party.state());
  }

  private broadcast(): void {
    const view = (this.lobbyOpen ? this.practice : this.match)?.view() ?? null;
    const party = this.party.state();
    this.network.openPeers.forEach((peer) => {
      this.network.send(peer, { type: 'view', view, party, seat: this.party.seat(peer, -1) });
    });
  }

  private buzz(key: string, kind: BuzzKind, strength: number): void {
    const peer = this.network.openPeers.find((candidate) => this.party.memberByPeer(candidate)?.id === key);
    const event: RollBuzz = { kind, strength: Math.round(strength * 100) / 100 };
    if (peer) this.network.send(peer, { type: 'event', event });
  }

  private renderConnection(stats: NetworkStats): void {
    const pill = this.query('[data-connection-pill]');
    pill.textContent = stats.controllers > 0
      ? `${stats.controllers} điện thoại`
      : stats.signaling === 'đã kết nối' ? 'Chờ điện thoại' : stats.signaling;
    pill.classList.toggle('is-online', stats.controllers > 0);
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Thiếu phần tử UI: ${selector}`);
    return element;
  }

  private template(): string {
    return `<main class="desktop-shell roll-shell">
      <section class="play-stage" data-roll-stage aria-label="Màn chơi cuộn giấy"></section>
      <header class="topbar">
        <div class="brand-lockup"><div class="brand-roll" aria-hidden="true"><i></i></div><div><strong>ROLL</strong><span>BALANCE PUZZLE</span></div></div>
        <div class="game-readout"><span>CHO XIN CUỘN GIẤY!</span><strong data-readout>Lăn thử</strong><small data-readout-hint>Nghiêng để lăn · hất máy để nhảy</small></div>
        <div class="top-actions">
          <a class="icon-button hub-home-button" href="${arcadeUrl()}" aria-label="Về kho game">${uiIcon('home')}<span>Kho game</span></a>
          <button class="icon-button theme-toggle" data-theme-toggle type="button"><span data-theme-icon aria-hidden="true"></span><span data-theme-label>Chế độ sáng</span></button>
          <span class="connection-pill" data-connection-pill>đang kết nối</span>
          <button class="icon-button" data-phone-toggle aria-label="Người chơi và mã QR">${uiIcon('players')}<span>Người chơi</span></button>
        </div>
      </header>

      <div class="party-banner" data-banner aria-live="polite"><span data-banner-kicker></span><strong data-banner-title></strong><small data-banner-sub></small></div>
      <ol class="player-strip is-hidden" data-roller-roster aria-label="Người chơi"></ol>
      <div class="warmup-hint" aria-hidden="true"><b>LĂN THỬ</b><span>Quét mã là cuộn giấy của bạn xuất hiện — nghiêng điện thoại để lăn tới nhà vệ sinh.</span></div>

      <nav class="settings-strip glass"><button data-view-cycle>Hiển thị: Tự động</button><button data-sound>Âm thanh: Bật</button></nav>

      ${HostLobby.panelHtml()}

      ${HostLobby.overlayHtml({
        eyebrow: 'GIAO GIẤY · PARTY',
        localTitle: 'Chơi trên máy này',
        localCopy: 'Một mình vượt từng màn, hoặc hai người chung bàn phím đua nhau giao giấy.',
        localHint: '<span class="key-hint"><b>P1</b><kbd>←</kbd><kbd>→</kbd> nghiêng <kbd>↑</kbd> nhảy</span><span class="key-hint"><b>P2</b><kbd>A</kbd><kbd>D</kbd> nghiêng <kbd>W</kbd> nhảy</span>',
        players: meta.players,
        extraHtml: `<section class="level-picker" aria-labelledby="level-picker-title">
          <div class="level-picker-head"><b id="level-picker-title">Bắt đầu từ màn</b><span data-level-picked></span></div>
          <div class="level-grid" data-level-grid></div>
        </section>
        <section class="level-picker view-picker" aria-labelledby="view-picker-title">
          <div class="level-picker-head"><b id="view-picker-title">Hiển thị</b></div>
          <div class="view-options" data-view-options>${VIEW_OPTIONS.map((option) => `<button type="button" data-view="${option.id}">${option.label}</button>`).join('')}</div>
          <p class="view-hint" data-view-hint></p>
        </section>`,
      })}

      <section class="modal-overlay is-hidden" data-level-overlay>
        <div class="mode-card glass"><span class="eyebrow" data-level-eyebrow>KẾT QUẢ MÀN</span><h1 data-level-title>Qua màn!</h1>
          <ol class="final-ranking final-ranking--race" data-level-ranking></ol>
          <p class="level-next" data-level-next></p>
          <div class="end-actions">
            <button class="primary-button" data-level-action="next">MÀN TIẾP →</button>
            <button class="primary-button" data-level-action="again">CHƠI LẠI TỪ ĐẦU</button>
            <button class="ghost-button" data-level-action="retry">CHƠI LẠI MÀN</button>
            <button class="ghost-button" data-open-lobby>VỀ SẢNH CHỜ</button>
          </div>
        </div>
      </section>
    </main>`;
  }
}
