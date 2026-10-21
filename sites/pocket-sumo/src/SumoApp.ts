import {
  arcadeUrl, bindThemeToggle, defaultPlayers, escapeHtml, getTheme, HostLobby, initials, onThemeChange, PartyRoom, PLAYER_COLORS,
  uiIcon, WebRTCHost, type CommandResult, type NetworkStats, type PartyCommand,
} from '@pocket/party-kit';
import { meta } from './meta';
import { parseSumoCommand, type BuzzKind, type SumoBuzz, type SumoCommand } from './protocol';
import { SumoAudio } from './SumoAudio';
import { SumoMatch, VARIANT_LABELS, WIN_ROUNDS, type FighterSetup, type MatchEvent } from './SumoMatch';
import { SumoRenderer } from './SumoRenderer';

const BROADCAST_MS = 120;
/** Không nhận input mới quá lâu (điện thoại khóa màn hình) thì coi như buông tay. */
const STALE_INPUT_MS = 500;
const BOT_NAMES = ['Bot Bánh Bao', 'Bot Mochi'];
const SPARRING_NAMES = ['Bao Cát', 'Bánh Dày', 'Bánh Giò'];
const FEED_LIMIT = 4;
const FEED_MS = 4_200;
/** Chiều rộng sảnh chờ thu gọn bên trái (khớp CSS .sumo-shell .lobby-card). */
const DOCKED_LOBBY_WIDTH = 470;

/** Bàn phím cho chế độ chơi trên máy này: P1 mũi tên + Enter, P2 WASD + F, P3 IJKL + O. Một mình thì Space cũng húc. */
const KEYMAP: Array<{ up: string; down: string; left: string; right: string; dash: string[] }> = [
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', dash: ['Enter', 'Slash', 'ShiftRight'] },
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', dash: ['KeyF', 'ShiftLeft', 'Space'] },
  { up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL', dash: ['KeyO', 'KeyU'] },
];
/** Đông hơn ngần này thì thẻ người chơi dưới màn hình thu nhỏ để vừa một hàng. */
const CROWDED_ROSTER = 5;

export class SumoApp {
  private readonly network = new WebRTCHost(parseSumoCommand);
  private readonly party = new PartyRoom(meta.players.max);
  private readonly lobby: HostLobby;
  private readonly renderer: SumoRenderer;
  private readonly audio = new SumoAudio();
  private match: SumoMatch | null = null;
  /** Sàn khởi động ở sảnh chờ: ai quét mã là có nhân vật chạy thử ngay. */
  private practice = new SumoMatch([], { practice: true });
  private humans = 0;
  private lobbyOpen = true;
  private resultsTimer = 0;
  private phonePanelOpen = false;
  private lastFrame = performance.now();
  private lastBroadcast = 0;
  private lastFeed = '';
  private lastRoster = '';
  private readonly keys = new Set<string>();
  private readonly lastSeq = new Map<string, number>();
  private readonly lastInputAt = new Map<string, number>();
  private readonly touching = new Map<string, boolean>();
  private feed: Array<{ html: string; at: number }> = [];

  constructor(private readonly root: HTMLElement) {
    document.title = 'Sumo';
    this.root.innerHTML = this.template();
    this.lobby = new HostLobby(this.root);
    this.renderer = new SumoRenderer(this.query('[data-play-stage]'));
    this.renderer.setTheme(getTheme());
    onThemeChange((theme) => this.renderer.setTheme(theme));
    this.bindUi();
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
    this.query<HTMLButtonElement>('[data-restart]').addEventListener('click', () => this.restart());
    this.root.querySelectorAll<HTMLButtonElement>('[data-open-lobby]').forEach((button) => {
      button.addEventListener('click', () => this.openLobby());
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
      if (local) {
        for (let index = 0; index < this.humans; index += 1) {
          if (this.dashKeys(index).includes(event.code) && !event.repeat) {
            const input = this.keyboardInput(index);
            this.match!.dash(`local-${index + 1}`, input.x, input.y);
          }
        }
        const used = KEYMAP.slice(0, this.humans).some((keys, index) => [keys.up, keys.down, keys.left, keys.right, ...this.dashKeys(index)].includes(event.code));
        if (used) event.preventDefault();
      }
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private dashKeys(index: number): string[] {
    const keys = KEYMAP[index]?.dash ?? [];
    return index === 0 && this.humans === 1 ? [...keys, 'Space'] : keys;
  }

  private keyboardInput(index: number): { x: number; y: number } {
    const keys = KEYMAP[index]!;
    const x = (this.keys.has(keys.right) ? 1 : 0) - (this.keys.has(keys.left) ? 1 : 0);
    const y = (this.keys.has(keys.down) ? 1 : 0) - (this.keys.has(keys.up) ? 1 : 0);
    return { x, y };
  }

  private withBots(players: FighterSetup[]): FighterSetup[] {
    if (players.length !== 1) return players;
    // Chơi một mình thì có hai bot vào sàn cho vui.
    const free = PLAYER_COLORS.filter((color) => color !== players[0]!.color);
    return [...players, ...BOT_NAMES.map((name, index) => ({ key: `bot-${index + 1}`, name, color: free[index]!, botSkill: 0.75 - index * 0.3 }))];
  }

  private startLocal(count: number): void {
    this.party.setLocal();
    this.humans = count;
    this.beginMatch(this.withBots(defaultPlayers(count).map((player, index) => ({ ...player, key: `local-${index + 1}` }))));
  }

  private startParty(): CommandResult {
    const lineup = this.party.startParty();
    if (!lineup) return { accepted: false, reason: 'Chưa có điện thoại nào trong phòng' };
    const members = this.party.state().members;
    this.humans = lineup.length;
    this.beginMatch(this.withBots(members.map((member) => ({ key: member.id, name: member.name, color: member.color }))));
    return { accepted: true };
  }

  private restart(): CommandResult {
    if (this.party.stage === 'party') return this.startParty();
    if (this.party.stage === 'local') {
      this.startLocal(this.humans || 1);
      return { accepted: true };
    }
    return { accepted: false, reason: 'Chưa có trận nào' };
  }

  private beginMatch(lineup: FighterSetup[]): void {
    this.match = new SumoMatch(lineup);
    this.renderer.reset();
    this.lastInputAt.clear();
    this.lobbyOpen = false;
    this.feed = [];
    window.clearTimeout(this.resultsTimer);
    this.query('[data-start-overlay]').classList.add('is-hidden');
    this.query('[data-end-overlay]').classList.add('is-hidden');
    this.setPhonePanel(false);
    this.layout();
    this.syncParty();
  }

  private openLobby(): void {
    this.party.backToLobby();
    this.match = null;
    this.lobbyOpen = true;
    window.clearTimeout(this.resultsTimer);
    this.renderer.reset();
    this.setPhonePanel(false);
    this.query('[data-end-overlay]').classList.add('is-hidden');
    this.query('[data-start-overlay]').classList.remove('is-hidden');
    this.layout();
    this.syncParty();
  }

  private setPhonePanel(open: boolean): void {
    this.phonePanelOpen = open;
    this.query('[data-phone-panel]').classList.toggle('is-open', open);
  }

  /** Sảnh chờ thu gọn bên trái để sàn khởi động hiện bên phải; màn hình hẹp thì sảnh phủ kín như các game khác. */
  private layout(): void {
    const docked = this.lobbyOpen && window.innerWidth > 1_000;
    this.root.querySelector('.sumo-shell')?.classList.toggle('is-docked', docked);
    this.renderer.setInset(docked ? DOCKED_LOBBY_WIDTH + 24 : 0);
  }

  private get active(): SumoMatch {
    return this.match ?? this.practice;
  }

  private readonly frame = (now: number): void => {
    const elapsed = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const active = this.active;
    this.applyInputs(active, now);
    active.advance(elapsed).forEach((event) => this.handleEvent(active, event, now));
    this.renderer.render(active, now, elapsed);
    if (now - this.lastBroadcast > BROADCAST_MS) {
      this.lastBroadcast = now;
      this.renderHud(active, now);
      this.broadcast();
    }
    requestAnimationFrame(this.frame);
  };

  private applyInputs(active: SumoMatch, now: number): void {
    if (this.party.stage === 'local' && this.match) {
      for (let index = 0; index < this.humans; index += 1) {
        const input = this.keyboardInput(index);
        this.match.setInput(`local-${index + 1}`, input.x, input.y);
      }
      return;
    }
    for (const fighter of active.fighters) {
      if (fighter.bot) continue;
      if (now - (this.lastInputAt.get(fighter.key) ?? 0) > STALE_INPUT_MS) active.setInput(fighter.key, 0, 0);
    }
  }

  private handleEvent(match: SumoMatch, event: MatchEvent, now: number): void {
    // Sảnh chỉ có bot chạy nền thì im lặng, có người khởi động mới phát tiếng.
    if (!match.practice || match.fighters.some((fighter) => !fighter.bot)) this.audio.event(event);
    this.renderer.effect(match, event, now);
    if (match.practice) return;
    if (event.type === 'bump' || event.type === 'clash') {
      if (event.other) this.buzz(event.other, 'hit', event.type === 'clash' ? 0.8 : event.strength);
      this.buzz(event.key, event.type === 'clash' ? 'hit' : 'land', event.type === 'clash' ? 0.8 : event.strength * 0.5);
    } else if (event.type === 'bumper') {
      this.buzz(event.key, 'hit', event.strength * 0.7);
    } else if (event.type === 'fall') {
      this.buzz(event.key, 'fall', 1);
      if (event.other) this.buzz(event.other, 'ko', 1);
      this.pushFeed(match, event.key, event.other);
    } else if (event.type === 'warn') {
      match.fighters.filter((fighter) => match.danger(fighter) > 0.8).forEach((fighter) => this.buzz(fighter.key, 'warn', 0.5));
    } else if (event.type === 'roundEnd') {
      if (event.winner) this.buzz(event.winner, 'round-win', 1);
      this.showBanner(match);
    } else if (event.type === 'matchEnd') {
      this.buzz(event.winner, 'match-win', 1);
      this.resultsTimer = window.setTimeout(() => this.showResults(match), 1_600);
    } else if (event.type === 'tick' || event.type === 'go') {
      this.showBanner(match, event.type === 'go' ? 'ĐẨY!' : String(event.value));
    }
    if (event.type === 'roundEnd' || event.type === 'matchEnd' || event.type === 'go') this.broadcast();
  }

  private pushFeed(match: SumoMatch, key: string, other: string | undefined): void {
    const victim = match.fighter(key);
    const attacker = other ? match.fighter(other) : undefined;
    if (!victim) return;
    const name = (fighter: { name: string; color: string }) => `<b style="--player-color: ${fighter.color}">${escapeHtml(fighter.name)}</b>`;
    const html = !attacker
      ? `${name(victim)} tự rơi khỏi sàn`
      : attacker.status === 'ghost'
        ? `Hồn ma ${name(attacker)} thổi bay ${name(victim)}`
        : `${name(attacker)} hất văng ${name(victim)}`;
    this.feed = [{ html, at: performance.now() }, ...this.feed].slice(0, FEED_LIMIT);
  }

  private showBanner(match: SumoMatch, countdown?: string): void {
    const banner = this.query('[data-banner]');
    const kicker = this.query('[data-banner-kicker]');
    const title = this.query('[data-banner-title]');
    const sub = this.query('[data-banner-sub]');
    if (countdown) {
      kicker.textContent = `VÒNG ${match.round} · CHẠM ${WIN_ROUNDS} ĐIỂM THẮNG`;
      title.textContent = countdown;
      sub.textContent = VARIANT_LABELS[match.variant];
      banner.style.setProperty('--player-color', 'var(--cyan)');
    } else {
      const winner = match.roundWinner ? match.fighter(match.roundWinner) : undefined;
      kicker.textContent = `KẾT THÚC VÒNG ${match.round}`;
      title.textContent = winner ? `${winner.name} thắng!` : 'Hòa — cùng rơi!';
      sub.textContent = winner ? `${match.score(winner.key).wins}/${WIN_ROUNDS} vòng thắng` : 'Không ai được điểm vòng này';
      banner.style.setProperty('--player-color', winner?.color ?? 'var(--cyan)');
    }
    banner.classList.remove('is-active', 'is-count');
    void banner.offsetWidth;
    banner.classList.add('is-active');
    banner.classList.toggle('is-count', Boolean(countdown));
  }

  private renderHud(active: SumoMatch, now: number): void {
    const readout = this.query('[data-readout]');
    const hint = this.query('[data-readout-hint]');
    if (active.practice) {
      readout.textContent = 'Sàn khởi động';
      hint.textContent = 'Quét QR là có nhân vật · kéo để chạy · vuốt để húc';
    } else if (active.phase === 'matchEnd') {
      readout.textContent = 'Kết thúc trận';
      hint.textContent = 'Chủ phòng bấm đấu lại ngay trên điện thoại';
    } else {
      readout.textContent = `Vòng ${active.round} · ${VARIANT_LABELS[active.variant]}`;
      const alive = active.fighters.filter((fighter) => fighter.status === 'alive').length;
      hint.textContent = active.warning > 0 ? 'Vòng ngoài sắp sụp — vào giữa ngay!' : `Còn ${alive} người trên sàn`;
    }
    this.query('.sumo-shell').classList.toggle('is-warning', active.warning > 0);

    this.feed = this.feed.filter((item) => now - item.at < FEED_MS);
    const feedHtml = this.feed.map((item) => `<li>${item.html}</li>`).join('');
    if (feedHtml !== this.lastFeed) {
      this.lastFeed = feedHtml;
      this.query('[data-ko-feed]').innerHTML = feedHtml;
    }

    const roster = active.practice ? '' : this.rosterHtml(active);
    if (roster !== this.lastRoster) {
      this.lastRoster = roster;
      const element = this.query('[data-player-strip]');
      element.innerHTML = roster;
      element.classList.toggle('is-hidden', !roster);
      element.classList.toggle('is-crowded', active.fighters.length > CROWDED_ROSTER);
    }
  }

  private rosterHtml(match: SumoMatch): string {
    const party = this.party.state();
    return match.fighters.map((fighter) => {
      const score = match.score(fighter.key);
      const member = party.members.find((entry) => entry.id === fighter.key);
      const pips = Array.from({ length: WIN_ROUNDS }, (_, index) => `<i class="${index < score.wins ? 'is-won' : ''}"></i>`).join('');
      const status = member && !member.connected
        ? 'MẤT KẾT NỐI · BOT ĐÁNH HỘ'
        : fighter.status === 'alive' ? 'TRÊN SÀN' : fighter.status === 'falling' ? 'ĐANG RƠI…' : 'HỒN MA · THỔI ĐƯỢC';
      return `<li class="player-card is-${fighter.status} ${member && !member.connected ? 'is-offline' : ''}" style="--player-color: ${fighter.color}">
        <span class="player-avatar">${escapeHtml(initials(fighter.name))}</span>
        <span class="player-copy"><strong>${escapeHtml(fighter.name)}</strong><small>${status}</small></span>
        <span class="player-score"><span class="player-pips">${pips}</span><small>${score.kos} KO</small></span>
      </li>`;
    }).join('');
  }

  private showResults(match: SumoMatch): void {
    if (match !== this.match) return;
    const ranked = match.ranking();
    const winner = match.fighter(ranked[0]!)!;
    this.query('[data-end-title]').textContent = `${winner.name} vô địch!`;
    this.query('[data-final-ranking]').innerHTML = ranked.map((key, position) => {
      const fighter = match.fighter(key)!;
      const score = match.score(key);
      return `<li style="--player-color: ${fighter.color}">
        <b>${position + 1}</b><i>${escapeHtml(initials(fighter.name))}</i><span>${escapeHtml(fighter.name)}<small>${score.kos} lần hất văng · rơi ${score.falls} lần</small></span><strong>${score.wins} ●</strong>
      </li>`;
    }).join('');
    this.query('[data-end-overlay]').classList.remove('is-hidden');
  }

  /** Sàn khởi động gồm mọi điện thoại đang kết nối; ít người thì có bao cát để đẩy thử. */
  private syncPractice(): void {
    const members = this.party.state().members.filter((member) => member.connected);
    const keep = new Set(members.map((member) => member.id));
    const sparring = members.length === 0 ? 3 : members.length === 1 ? 1 : 0;
    SPARRING_NAMES.slice(0, sparring).forEach((_, index) => keep.add(`spar-${index + 1}`));
    this.practice.fighters.filter((fighter) => !keep.has(fighter.key)).forEach((fighter) => this.practice.removeFighter(fighter.key));
    members.forEach((member) => {
      const isNew = !this.practice.fighter(member.id);
      this.practice.addFighter({ key: member.id, name: member.name, color: member.color });
      if (isNew) this.renderer.effect(this.practice, { type: 'spawn', key: member.id }, performance.now());
    });
    const used = new Set(members.map((member) => member.color));
    const free = PLAYER_COLORS.filter((color) => !used.has(color));
    SPARRING_NAMES.slice(0, sparring).forEach((name, index) => {
      this.practice.addFighter({ key: `spar-${index + 1}`, name, color: free[index % free.length] ?? PLAYER_COLORS[index]!, botSkill: members.length ? 0.3 : 0.65 });
    });
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
      if (!member || typeof sample.seq !== 'number' || typeof sample.x !== 'number' || typeof sample.y !== 'number') return;
      // Kênh telemetry không đảm bảo thứ tự: bỏ mẫu cũ hơn mẫu đã dùng.
      if (sample.seq <= (this.lastSeq.get(peer) ?? -1)) return;
      this.lastSeq.set(peer, sample.seq);
      const match = this.matchFor(member.id);
      if (!match) return;
      match.setInput(member.id, clamp(sample.x), clamp(sample.y));
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
  private matchFor(memberId: string): SumoMatch | null {
    if (this.party.stage === 'party' && this.match?.fighter(memberId)) return this.match;
    if (this.lobbyOpen && this.practice.fighter(memberId)) return this.practice;
    return null;
  }

  private handleCommand(peer: string, command: PartyCommand | SumoCommand): CommandResult | void {
    if (command.type === 'hello') {
      const result = this.party.join(peer, command.clientId, command.name);
      if (!result.member) {
        this.network.send(peer, { type: 'notice', message: result.reason });
      } else {
        const fighter = this.match?.fighter(result.member.id);
        if (fighter) fighter.name = result.member.name;
      }
      this.syncParty();
      return;
    }
    const seat = this.party.seat(peer, -1);
    if (command.type === 'lobby') {
      if (!seat.leader) return { accepted: false, reason: 'Chỉ chủ phòng mới điều khiển được sảnh' };
      if (command.action === 'start') {
        return this.party.stage === 'lobby' ? this.startParty() : { accepted: false, reason: 'Đang đấu rồi' };
      }
      return this.match?.phase === 'matchEnd' ? this.restart() : { accepted: false, reason: 'Trận chưa kết thúc' };
    }
    if (command.type === 'dash') {
      const member = this.party.memberByPeer(peer);
      const match = member ? this.matchFor(member.id) : null;
      if (!member || !match) return { accepted: false };
      return { accepted: match.dash(member.id, command.x, command.y) };
    }
  }

  private syncParty(): void {
    if (this.lobbyOpen) this.syncPractice();
    const members = this.party.state().members;
    if (this.match && this.party.stage === 'party') {
      // Điện thoại rớt mạng giữa trận thì bot đánh hộ tới khi nối lại.
      members.forEach((member) => this.match!.setAutopilot(member.id, !member.connected));
    }
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
    const event: SumoBuzz = { kind, strength: Math.round(strength * 100) / 100 };
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
    return `<main class="desktop-shell sumo-shell">
      <section class="play-stage" data-play-stage aria-label="Sàn đấu sumo"></section>
      <header class="topbar">
        <div class="brand-lockup"><div class="brand-sumo" aria-hidden="true"><i></i></div><div><strong>SUMO</strong><span>PARTY BRAWL</span></div></div>
        <div class="game-readout"><span>ĐẨY NHAU RA KHỎI SÀN</span><strong data-readout>Sàn khởi động</strong><small data-readout-hint>Kéo để chạy · vuốt để húc</small></div>
        <div class="top-actions">
          <a class="icon-button hub-home-button" href="${arcadeUrl()}" aria-label="Về kho game">${uiIcon('home')}<span>Kho game</span></a>
          <button class="icon-button theme-toggle" data-theme-toggle type="button"><span data-theme-icon aria-hidden="true"></span><span data-theme-label>Chế độ sáng</span></button>
          <span class="connection-pill" data-connection-pill>đang kết nối</span>
          <button class="icon-button" data-phone-toggle aria-label="Người chơi và mã QR">${uiIcon('players')}<span>Người chơi</span></button>
        </div>
      </header>

      <ol class="ko-feed" data-ko-feed aria-live="polite"></ol>
      <div class="party-banner" data-banner aria-live="polite"><span data-banner-kicker></span><strong data-banner-title></strong><small data-banner-sub></small></div>
      <ol class="player-strip is-hidden" data-player-strip aria-label="Người chơi"></ol>
      <div class="warmup-hint" aria-hidden="true"><b>SÀN KHỞI ĐỘNG</b><span>Quét mã là nhân vật của bạn rơi xuống đây — chạy thử, húc thử trước khi vào trận.</span></div>

      <nav class="settings-strip glass"><button data-sound>Âm thanh: Bật</button></nav>

      ${HostLobby.panelHtml()}

      ${HostLobby.overlayHtml({
        eyebrow: 'ĐẤU SUMO · PARTY',
        localTitle: 'Chơi trên máy này',
        localCopy: 'Một mình đấu với hai bot, hoặc tối đa ba người chung bàn phím.',
        localHint: '<span class="key-hint"><b>P1</b><kbd>←↑↓→</kbd> đi <kbd>Enter</kbd> húc</span><span class="key-hint"><b>P2</b><kbd>WASD</kbd> đi <kbd>F</kbd> húc</span><span class="key-hint"><b>P3</b><kbd>IJKL</kbd> đi <kbd>O</kbd> húc</span>',
        players: meta.players,
      })}

      <section class="modal-overlay is-hidden" data-end-overlay>
        <div class="mode-card glass"><span class="eyebrow">KẾT QUẢ · ● LÀ VÒNG THẮNG</span><h1 data-end-title>Vô địch!</h1>
          <ol class="final-ranking final-ranking--race" data-final-ranking></ol>
          <div class="end-actions"><button class="primary-button" data-restart>ĐẤU LẠI</button><button class="ghost-button" data-open-lobby>VỀ SẢNH CHỜ</button></div>
        </div>
      </section>
    </main>`;
  }
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
