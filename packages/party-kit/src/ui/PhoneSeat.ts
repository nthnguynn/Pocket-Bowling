import { escapeHtml, initials, sanitizePlayerName } from '../game/players';
import type { PartyState, Seat } from '../types';

const NAME_KEY = 'pocket-player-name';
function loadName(): string {
  try {
    return sanitizePlayerName(localStorage.getItem(NAME_KEY));
  } catch {
    return '';
  }
}

/**
 * Thẻ "bạn là ai" + sảnh chờ trên điện thoại, dùng chung cho mọi game.
 * Tên là tùy chọn: để trống thì màn hình chính tự đặt "Người chơi N".
 */
export class PhoneSeat {
  name = loadName();
  onName?: (name: string) => void;
  onStart?: () => void;
  private nameTimer = 0;

  constructor(private readonly root: HTMLElement) {}

  static html(): string {
    return `<section class="seat-card" aria-label="Người chơi của bạn">
        <i class="seat-avatar" data-seat-avatar aria-hidden="true">?</i>
        <label class="seat-name"><span>TÊN HIỂN THỊ TRÊN MÀN HÌNH</span><input data-name-input maxlength="16" placeholder="Nhập tên của bạn" autocomplete="nickname" enterkeyhint="done"></label>
        <span class="seat-badge" data-seat-badge>—</span>
      </section>

      <section class="phone-lobby" aria-label="Sảnh chờ">
        <div class="phone-section-head"><b>Đang chờ trong sảnh</b><span data-lobby-count>0/6</span></div>
        <ul class="party-roster party-roster--phone" data-phone-roster></ul>
        <button class="primary-button phone-wide-button is-hidden" data-phone-start>BẮT ĐẦU VÁN</button>
        <p class="phone-lobby-copy" data-lobby-wait>Chờ chủ phòng bắt đầu ván…</p>
      </section>`;
  }

  bind(): void {
    const input = this.query<HTMLInputElement>('[data-name-input]');
    input.value = this.name;
    const commit = () => {
      window.clearTimeout(this.nameTimer);
      this.nameTimer = 0;
      const name = sanitizePlayerName(input.value);
      if (name === this.name) return;
      this.name = name;
      try {
        localStorage.setItem(NAME_KEY, name);
      } catch {
        // Tên vẫn được gửi cho phòng hiện tại.
      }
      this.onName?.(name);
    };
    input.addEventListener('input', () => {
      window.clearTimeout(this.nameTimer);
      this.nameTimer = window.setTimeout(commit, 700);
    });
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
    });
    this.query<HTMLButtonElement>('[data-phone-start]').addEventListener('click', () => this.onStart?.());
  }

  /** Cập nhật thẻ ghế, sảnh chờ và màu chủ đạo của điện thoại theo ghế host đã gán. */
  render(party: PartyState, seat: Seat): void {
    const me = party.members.find((member) => member.id === seat.member);
    this.root.style.setProperty('--player-color', me?.color ?? 'var(--cyan)');

    const input = this.query<HTMLInputElement>('[data-name-input]');
    if (me && document.activeElement !== input && !this.nameTimer) input.value = me.name;
    this.query('[data-seat-avatar]').textContent = initials(me?.name ?? (input.value || '?'));
    const tags: string[] = [];
    if (!seat.member) tags.push('ĐANG XEM');
    else if (party.stage === 'party') tags.push(seat.player === null ? 'VÁN SAU' : `P${seat.player + 1}`);
    else if (party.stage === 'local') tags.push('TAY CẦM CHUNG');
    if (seat.leader) tags.push('CHỦ PHÒNG');
    this.query('[data-seat-badge]').textContent = tags.join(' · ') || 'TRONG SẢNH';

    const online = party.members.filter((member) => member.connected);
    this.query('[data-lobby-count]').textContent = `${online.length}/${party.maxPlayers}`;
    this.query('[data-phone-roster]').innerHTML = party.members.map((member) => `<li class="party-chip ${member.connected ? '' : 'is-offline'} ${member.id === seat.member ? 'is-me' : ''}" style="--player-color: ${member.color}">
      <i>${escapeHtml(initials(member.name))}</i><span>${escapeHtml(member.name)}</span>${member.id === party.leader ? '<small>CHỦ PHÒNG</small>' : ''}${member.id === seat.member ? '<small>BẠN</small>' : ''}
    </li>`).join('');
    const start = this.query<HTMLButtonElement>('[data-phone-start]');
    start.classList.toggle('is-hidden', !seat.leader);
    start.textContent = `BẮT ĐẦU VÁN · ${online.length} NGƯỜI`;
    const leader = party.members.find((member) => member.id === party.leader);
    this.query('[data-lobby-wait]').textContent = seat.leader
      ? 'Bạn là chủ phòng. Chờ đủ người rồi bấm bắt đầu — mọi người cùng xem trên màn hình chính.'
      : `Chờ ${leader?.name ?? 'chủ phòng'} bắt đầu ván…`;
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Thiếu phần tử UI: ${selector}`);
    return element;
  }
}
