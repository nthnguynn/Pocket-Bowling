import QRCode from 'qrcode';
import { arcadeUrl } from '../links';
import { escapeHtml, initials } from '../players';
import type { PartyState, PlayerLimits } from '../types';

export interface LobbyCopy {
  eyebrow: string;
  localTitle: string;
  localCopy: string;
  /** HTML tin cậy (do code viết sẵn), ví dụ có thẻ <kbd>. */
  localHint: string;
  players: PlayerLimits;
  /** HTML tin cậy riêng của từng game, đặt dưới hai cột (ví dụ chọn màn). */
  extraHtml?: string;
}

const LOCAL_LABELS = ['MỘT MÌNH', 'HAI NGƯỜI', 'BA NGƯỜI', 'BỐN NGƯỜI'];

/** Mỗi game là một site riêng nên trang tay cầm nằm ngay trên site này, chỉ thêm ?controller=1&room=…. */
export function controllerUrl(room: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('controller', '1');
  url.searchParams.set('room', room);
  return url.toString();
}

/**
 * Sảnh chờ trên màn hình chính (TV/laptop): QR, mã phòng, danh sách điện thoại và nút bắt đầu.
 * Dùng chung cho mọi game; game chỉ quyết định chuyện gì xảy ra khi bấm bắt đầu.
 */
export class HostLobby {
  constructor(private readonly root: HTMLElement) {}

  static overlayHtml(copy: LobbyCopy): string {
    return `<section class="modal-overlay lobby-overlay" data-start-overlay>
      <div class="lobby-card glass">
        <header class="lobby-head">
          <span class="eyebrow">${copy.eyebrow}</span>
          <h1>Cùng chơi trên một màn hình</h1>
          <ol class="party-steps">
            <li><b>1</b><span>Mở game trên TV hoặc laptop</span></li>
            <li><b>2</b><span>Mọi người quét mã QR</span></li>
            <li><b>3</b><span>Cùng chơi trên một màn hình</span></li>
          </ol>
        </header>
        <div class="lobby-grid">
          <section class="lobby-party" data-lobby-party aria-labelledby="lobby-party-title">
            <div class="lobby-join">
              <div class="qr-frame qr-frame--lobby"><canvas width="300" height="300" data-qr data-qr-size="300"></canvas></div>
              <div class="lobby-join-copy">
                <span class="eyebrow">MỖI ĐIỆN THOẠI LÀ MỘT NGƯỜI CHƠI</span>
                <h2 id="lobby-party-title">Quét để vào phòng</h2>
                <div class="room-code"><small>MÃ PHÒNG</small><strong data-room-code>—</strong></div>
                <p class="panel-copy" data-room-status>Đang tạo phòng…</p>
              </div>
            </div>
            <div class="lobby-roster-head"><b>Người chơi</b><span data-party-count>0/${copy.players.max}</span></div>
            <ul class="party-roster" data-party-roster></ul>
            <button class="primary-button lobby-start" data-party-start disabled>CHỜ NGƯỜI CHƠI QUÉT MÃ…</button>
            <small class="lobby-hint" data-party-hint></small>
          </section>
          <section class="lobby-local" aria-labelledby="lobby-local-title">
            <span class="eyebrow">KHÔNG CẦN ĐIỆN THOẠI</span>
            <h2 id="lobby-local-title">${copy.localTitle}</h2>
            <p>${copy.localCopy}</p>
            <div class="mode-grid">${copy.players.local.map((count) => `<button data-players="${count}"><strong>${String(count).padStart(2, '0')}</strong><span>${LOCAL_LABELS[count - 1] ?? `${count} NGƯỜI`}</span></button>`).join('')}</div>
            <small>${copy.localHint}</small>
          </section>
        </div>
        ${copy.extraHtml ?? ''}
        <a class="mode-back" href="${arcadeUrl()}">← VỀ KHO GAME</a>
      </div>
    </section>`;
  }

  static panelHtml(): string {
    return `<aside class="side-panel phone-panel glass" data-phone-panel>
      <button class="panel-close" data-phone-close aria-label="Đóng">×</button>
      <span class="eyebrow">TAY CẦM WEBRTC</span><h2>Quét để vào phòng</h2>
      <p class="panel-copy" data-room-status>Đang tạo phòng signaling…</p>
      <div class="qr-frame"><canvas width="220" height="220" data-qr data-qr-size="220"></canvas></div>
      <div class="room-code"><small>MÃ PHÒNG</small><strong data-room-code>—</strong></div>
      <div class="panel-roster"><b>Điện thoại trong phòng</b><ul class="party-roster party-roster--compact" data-party-roster></ul></div>
      <button class="ghost-button" data-open-lobby>MỞ SẢNH CHỜ · ĐỔI NGƯỜI CHƠI</button>
      <p class="security-note">Điện thoại chỉ gửi input. Vật lý và điểm số luôn do màn hình chính quyết định.</p>
    </aside>`;
  }

  renderRoom(room: string): void {
    const formatted = `${room.slice(0, 5)}-${room.slice(5)}`;
    this.all('[data-room-code]').forEach((element) => { element.textContent = formatted; });
    this.all('[data-room-status]').forEach((element) => {
      element.textContent = `Hoặc mở ${location.host} trên điện thoại và nhập mã. Phòng mở khi tab này còn mở.`;
    });
    const url = controllerUrl(room);
    this.all<HTMLCanvasElement>('[data-qr]').forEach((canvas) => {
      const width = Number(canvas.dataset.qrSize) || 220;
      void QRCode.toCanvas(canvas, url, { width, margin: 1, color: { dark: '#07111f', light: '#ffffff' } });
    });
  }

  renderOffline(): void {
    this.all('[data-room-status]').forEach((element) => {
      element.textContent = 'Máy chủ ghép nối chưa chạy — vẫn chơi được trên máy này.';
    });
    this.root.querySelector('[data-lobby-party]')?.classList.add('is-offline');
  }

  renderParty(state: PartyState): void {
    const online = state.members.filter((member) => member.connected).length;
    const chips = state.members.map((member) => {
      const tags = [
        member.id === state.leader ? '<small>CHỦ PHÒNG</small>' : '',
        !member.connected ? '<small class="is-warning">MẤT KẾT NỐI</small>' : '',
        state.stage === 'party' && member.player === null ? '<small>VÁN SAU</small>' : '',
      ].join('');
      return `<li class="party-chip ${member.connected ? '' : 'is-offline'}" style="--player-color: ${member.color}">
        <i>${escapeHtml(initials(member.name))}</i><span>${escapeHtml(member.name)}</span>${tags}
      </li>`;
    });
    if (state.members.length < state.maxPlayers) {
      chips.push('<li class="party-chip is-empty"><i>+</i><span>Quét QR để vào</span></li>');
    }
    this.all('[data-party-roster]').forEach((list) => { list.innerHTML = chips.join(''); });
    this.all('[data-party-count]').forEach((element) => { element.textContent = `${online}/${state.maxPlayers}`; });

    const start = this.root.querySelector<HTMLButtonElement>('[data-party-start]');
    if (start) {
      start.disabled = online === 0;
      start.textContent = online ? `BẮT ĐẦU · ${online} NGƯỜI CHƠI` : 'CHỜ NGƯỜI CHƠI QUÉT MÃ…';
    }
    const leader = state.members.find((member) => member.id === state.leader);
    const hint = this.root.querySelector('[data-party-hint]');
    if (hint) {
      hint.textContent = leader
        ? `${leader.name} là chủ phòng — có thể bấm bắt đầu ngay trên điện thoại.`
        : 'Người vào đầu tiên là chủ phòng và có thể bắt đầu ván ngay trên điện thoại.';
    }
  }

  private all<T extends Element = HTMLElement>(selector: string): T[] {
    return [...this.root.querySelectorAll<T>(selector)];
  }
}
