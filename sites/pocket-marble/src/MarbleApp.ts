import {
  arcadeUrl, bindThemeToggle, defaultPlayers, escapeHtml, getTheme, HostLobby, initials, onThemeChange, PartyRoom, PLAYER_COLORS,
  uiIcon, WebRTCHost, type CommandResult, type NetworkStats, type PartyCommand, type PlayerSetup,
} from '@pocket/party-kit';
import { MarbleAudio } from './MarbleAudio';
import { meta } from './meta';
import { MARBLE_BUZZ_KINDS, parseMarbleCommand, type MarbleCommand } from './protocol';
import { MarbleRace, type RacerSetup } from './MarbleRace';
import { formatSeconds, MarbleRenderer } from './MarbleRenderer';

const BROADCAST_MS = 200;
/** Không nhận độ nghiêng mới quá lâu (điện thoại khóa màn hình) thì coi như cầm thẳng. */
const STALE_TILT_MS = 700;
const BOT_NAMES = ['Bot Tốc Độ', 'Bot Lăn Tròn'];

/** Bàn phím cho chế độ chơi trên máy này: P1 mũi tên, P2 A/D/W, P3 J/L/I. */
const KEYMAP: Array<{ left: string; right: string; jump: string[] }> = [
  { left: 'ArrowLeft', right: 'ArrowRight', jump: ['ArrowUp', 'Space'] },
  { left: 'KeyA', right: 'KeyD', jump: ['KeyW'] },
  { left: 'KeyJ', right: 'KeyL', jump: ['KeyI'] },
];

export class MarbleApp {
  private readonly network = new WebRTCHost(parseMarbleCommand);
  private readonly party = new PartyRoom(meta.players.max);
  private readonly lobby: HostLobby;
  private readonly renderer: MarbleRenderer;
  private readonly audio = new MarbleAudio();
  private race: MarbleRace | null = null;
  /** Cuộc đua chạy nền sau sảnh chờ, toàn bot. */
  private demo: MarbleRace;
  private humans = 0;
  private lobbyOpen = true;
  private resultsShown = false;
  private phonePanelOpen = false;
  private lastFrame = performance.now();
  private lastBroadcast = 0;
  private lastCountdown = 0;
  private readonly keys = new Set<string>();
  private readonly keyboardTilt = KEYMAP.map(() => 0);
  private readonly lastSeq = new Map<string, number>();
  private readonly lastTiltAt = new Map<number, number>();

  constructor(private readonly root: HTMLElement) {
    document.title = 'Marble';
    this.root.innerHTML = this.template();
    this.lobby = new HostLobby(this.root);
    this.renderer = new MarbleRenderer(this.query('[data-race-stage]'));
    this.renderer.setTheme(getTheme());
    onThemeChange((theme) => this.renderer.setTheme(theme));
    this.demo = this.createDemo();
    this.bindUi();
    this.renderParty();
    requestAnimationFrame(this.frame);
    void this.startNetwork();
  }

  private createDemo(): MarbleRace {
    return new MarbleRace(PLAYER_COLORS.slice(0, 3).map((color, index) => ({ name: `Demo ${index + 1}`, color, botSkill: 1 - index * 0.25 })));
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
      const local = this.party.stage === 'local' && !this.lobbyOpen;
      // Chỉ phím của người đang chơi: phím P2 khi chơi một mình không được làm bot nhảy.
      const players = KEYMAP.slice(0, this.humans);
      players.forEach((keys, index) => {
        if (local && keys.jump.includes(event.code) && !event.repeat) this.race?.jump(index);
      });
      if (local && players.some((keys) => [keys.left, keys.right, ...keys.jump].includes(event.code))) event.preventDefault();
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private lineupWithBots(players: PlayerSetup[]): RacerSetup[] {
    if (players.length !== 1) return players;
    // Chơi một mình thì có hai bot đua cùng cho vui.
    const free = PLAYER_COLORS.filter((color) => color !== players[0]!.color);
    return [...players, ...BOT_NAMES.map((name, index) => ({ name, color: free[index]!, botSkill: 0.8 - index * 0.3 }))];
  }

  private startLocal(count: number): void {
    this.party.setLocal();
    this.humans = count;
    this.beginRace(this.lineupWithBots(defaultPlayers(count)));
  }

  private startParty(): CommandResult {
    const lineup = this.party.startParty();
    if (!lineup) return { accepted: false, reason: 'Chưa có điện thoại nào trong phòng' };
    this.humans = lineup.length;
    this.beginRace(this.lineupWithBots(lineup));
    return { accepted: true };
  }

  private restart(): CommandResult {
    if (this.party.stage === 'party') return this.startParty();
    if (this.party.stage === 'local') {
      this.startLocal(this.humans || 1);
      return { accepted: true };
    }
    return { accepted: false, reason: 'Chưa có cuộc đua nào' };
  }

  private beginRace(lineup: RacerSetup[]): void {
    this.race = new MarbleRace(lineup);
    this.renderer.reset();
    this.lastTiltAt.clear();
    this.keyboardTilt.fill(0);
    this.lobbyOpen = false;
    this.resultsShown = false;
    this.lastCountdown = 0;
    this.query('[data-start-overlay]').classList.add('is-hidden');
    this.query('[data-end-overlay]').classList.add('is-hidden');
    this.setPhonePanel(false);
    this.syncParty();
  }

  private openLobby(): void {
    this.party.backToLobby();
    this.race = null;
    this.lobbyOpen = true;
    this.renderer.reset();
    this.setPhonePanel(false);
    this.query('[data-end-overlay]').classList.add('is-hidden');
    this.query('[data-start-overlay]').classList.remove('is-hidden');
    this.query('[data-readout]').textContent = 'Sảnh chờ';
    this.syncParty();
  }

  private setPhonePanel(open: boolean): void {
    this.phonePanelOpen = open;
    this.query('[data-phone-panel]').classList.toggle('is-open', open);
  }

  private readonly frame = (now: number): void => {
    const elapsed = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const race = this.race;
    if (race) {
      this.applyInputs(race, now, elapsed);
      race.advance(elapsed).forEach((event) => {
        this.audio.event(event.type);
        this.renderer.effect(race, event, now);
        this.buzz(event.racer, event.type);
      });
      this.tickCountdown(race);
      this.renderReadout(race);
      if (race.phase === 'finished' && !this.resultsShown) this.showResults(race);
      if (now - this.lastBroadcast > BROADCAST_MS) {
        this.lastBroadcast = now;
        this.broadcast();
      }
      this.renderer.render(race, now, elapsed);
    } else {
      this.demo.advance(elapsed);
      if (this.demo.phase === 'finished') this.demo = this.createDemo();
      this.renderer.render(this.demo, now, elapsed);
    }
    requestAnimationFrame(this.frame);
  };

  private applyInputs(race: MarbleRace, now: number, elapsed: number): void {
    if (this.party.stage === 'local') {
      KEYMAP.slice(0, this.humans).forEach((keys, index) => {
        const target = (this.keys.has(keys.right) ? 1 : 0) - (this.keys.has(keys.left) ? 1 : 0);
        this.keyboardTilt[index]! += (target - this.keyboardTilt[index]!) * Math.min(1, elapsed * 10);
        race.setTilt(index, this.keyboardTilt[index]!);
      });
      return;
    }
    for (let index = 0; index < this.humans; index += 1) {
      if (now - (this.lastTiltAt.get(index) ?? 0) > STALE_TILT_MS) race.setTilt(index, 0);
    }
  }

  private tickCountdown(race: MarbleRace): void {
    if (race.phase === 'countdown') {
      const remaining = Math.ceil(-race.time);
      if (remaining !== this.lastCountdown) {
        this.lastCountdown = remaining;
        this.audio.countdown(false);
      }
    } else if (this.lastCountdown !== -1) {
      this.lastCountdown = -1;
      this.audio.countdown(true);
      this.broadcast();
    }
  }

  private renderReadout(race: MarbleRace): void {
    const view = race.view();
    const readout = this.query('[data-readout]');
    if (race.phase === 'countdown') readout.textContent = 'Chuẩn bị…';
    else if (race.phase === 'finished') readout.textContent = 'Kết thúc';
    else if (view.graceLeft !== null) readout.textContent = `Còn ${Math.ceil(view.graceLeft)}s để về đích`;
    else readout.textContent = formatSeconds(view.time);
  }

  private showResults(race: MarbleRace): void {
    this.resultsShown = true;
    const view = race.view();
    const ranked = race.ranking();
    const winner = view.racers[ranked[0]!]!;
    this.query('[data-end-title]').textContent = winner.finishTime === null
      ? 'Không ai về đích!'
      : ranked.length > 1 ? `${winner.name} thắng!` : 'Hoàn thành!';
    this.query('[data-final-ranking]').innerHTML = ranked.map((index, position) => {
      const racer = view.racers[index]!;
      const detail = racer.finishTime !== null
        ? `${formatSeconds(racer.finishTime)} − ${racer.gems} ♦`
        : `${racer.status === 'out' ? 'bị loại' : 'chưa về'} · ${Math.round(racer.progress * 100)}%`;
      return `<li style="--player-color: ${racer.color}">
        <b>${position + 1}</b><i>${escapeHtml(initials(racer.name))}</i><span>${escapeHtml(racer.name)}<small>${detail}</small></span><strong>${racer.score === null ? '—' : formatSeconds(racer.score)}</strong>
      </li>`;
    }).join('');
    this.query('[data-end-overlay]').classList.remove('is-hidden');
    this.broadcast();
  }

  private async startNetwork(): Promise<void> {
    this.network.onRoom = (room) => this.lobby.renderRoom(room);
    this.network.onStats = (stats) => this.renderConnection(stats);
    this.network.onPeerOpen = () => this.broadcast();
    this.network.onPeerClose = (peer) => {
      this.party.leave(peer);
      this.lastSeq.delete(peer);
      this.syncParty();
    };
    this.network.onCommand = (peer, command) => this.handleCommand(peer, command);
    this.network.onTelemetry = (peer, sample) => {
      const player = this.party.stage === 'party' ? this.party.seat(peer, -1).player : null;
      if (player === null || typeof sample.seq !== 'number' || typeof sample.tilt !== 'number') return;
      // Kênh telemetry không đảm bảo thứ tự: bỏ mẫu cũ hơn mẫu đã dùng.
      if (sample.seq <= (this.lastSeq.get(peer) ?? -1)) return;
      this.lastSeq.set(peer, sample.seq);
      this.race?.setTilt(player, sample.tilt);
      this.lastTiltAt.set(player, performance.now());
    };
    try {
      await this.network.start();
    } catch {
      this.lobby.renderOffline();
    }
  }

  private handleCommand(peer: string, command: PartyCommand | MarbleCommand): CommandResult | void {
    if (command.type === 'hello') {
      const result = this.party.join(peer, command.clientId, command.name);
      if (!result.member) {
        this.network.send(peer, { type: 'notice', message: result.reason });
      } else {
        const player = this.party.playerIndex(result.member.id);
        const racer = player === null ? undefined : this.race?.racers[player];
        if (racer) racer.name = result.member.name;
      }
      this.syncParty();
      return;
    }
    const seat = this.party.seat(peer, -1);
    if (command.type === 'lobby') {
      if (!seat.leader) return { accepted: false, reason: 'Chỉ chủ phòng mới điều khiển được sảnh' };
      if (command.action === 'start') {
        return this.party.stage === 'lobby' ? this.startParty() : { accepted: false, reason: 'Đang đua rồi' };
      }
      return this.race?.phase === 'finished' ? this.restart() : { accepted: false, reason: 'Cuộc đua chưa kết thúc' };
    }
    if (command.type === 'jump') {
      if (this.party.stage !== 'party' || seat.player === null || !this.race) return { accepted: false };
      this.race.jump(seat.player);
      return { accepted: true };
    }
  }

  private syncParty(): void {
    this.renderParty();
    this.broadcast();
  }

  /** Rung + chữ nổi tức thì trên điện thoại của người gây ra sự kiện (chỉ khi chơi bằng điện thoại). */
  private buzz(racer: number, type: string): void {
    if (this.party.stage !== 'party' || !MARBLE_BUZZ_KINDS.has(type)) return;
    const peer = this.party.ownerOf(racer)?.peer;
    if (peer) this.network.send(peer, { type: 'event', event: { kind: type } });
  }

  private renderParty(): void {
    this.lobby.renderParty(this.party.state());
  }

  private broadcast(): void {
    const view = this.race?.view() ?? null;
    const party = this.party.state();
    this.network.openPeers.forEach((peer) => {
      this.network.send(peer, { type: 'view', view, party, seat: this.party.seat(peer, -1) });
    });
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
    return `<main class="desktop-shell marble-shell">
      <section class="race-stage" data-race-stage aria-label="Đường đua bi"></section>
      <header class="topbar">
        <div class="brand-lockup"><div class="brand-marble" aria-hidden="true"></div><div><strong>MARBLE</strong><span>PARTY RACE</span></div></div>
        <div class="game-readout"><span>ĐƯỜNG ĐUA BI</span><strong data-readout>Sảnh chờ</strong><small>Nghiêng để lái · hất máy để nhảy · 3 mạng, hết mạng là bị loại</small></div>
        <div class="top-actions">
          <a class="icon-button hub-home-button" href="${arcadeUrl()}" aria-label="Về kho game">${uiIcon('home')}<span>Kho game</span></a>
          <button class="icon-button theme-toggle" data-theme-toggle type="button"><span data-theme-icon aria-hidden="true"></span><span data-theme-label>Chế độ sáng</span></button>
          <span class="connection-pill" data-connection-pill>đang kết nối</span>
          <button class="icon-button" data-phone-toggle aria-label="Người chơi và mã QR">${uiIcon('players')}<span>Người chơi</span></button>
        </div>
      </header>

      <nav class="settings-strip glass"><button data-sound>Âm thanh: Bật</button></nav>

      ${HostLobby.panelHtml()}

      ${HostLobby.overlayHtml({
        eyebrow: 'ĐƯỜNG ĐUA BI · PARTY',
        localTitle: 'Chơi trên máy này',
        localCopy: 'Một mình đua cùng hai bot, hoặc tối đa ba người chung bàn phím.',
        localHint: '<span class="key-hint"><b>P1</b><kbd>←</kbd><kbd>→</kbd> lái <kbd>↑</kbd> nhảy</span><span class="key-hint"><b>P2</b><kbd>A</kbd><kbd>D</kbd> lái <kbd>W</kbd> nhảy</span><span class="key-hint"><b>P3</b><kbd>J</kbd><kbd>L</kbd> lái <kbd>I</kbd> nhảy</span>',
        players: meta.players,
      })}

      <section class="modal-overlay is-hidden" data-end-overlay>
        <div class="mode-card glass"><span class="eyebrow">KẾT QUẢ · MỖI ♦ TRỪ 0,5 GIÂY</span><h1 data-end-title>Hoàn thành!</h1>
          <ol class="final-ranking final-ranking--race" data-final-ranking></ol>
          <div class="end-actions"><button class="primary-button" data-restart>ĐUA LẠI</button><button class="ghost-button" data-open-lobby>VỀ SẢNH CHỜ</button></div>
        </div>
      </section>
    </main>`;
  }
}
