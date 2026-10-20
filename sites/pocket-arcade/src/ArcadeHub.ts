import { GAME_CATALOG, type GameCatalogItem } from '../hub/gameCatalog';
import { bindThemeToggle } from './theme';

export class ArcadeHub {
  constructor(private readonly root: HTMLElement) {
    document.title = 'Pocket Arcade — Kho game';
    document.body.classList.add('hub-page');
    this.root.innerHTML = this.template();
    this.bind();
  }

  private bind(): void {
    bindThemeToggle(this.root);
    this.root.querySelectorAll<HTMLButtonElement>('[data-game-route]').forEach((button) => {
      const warmGame = (): void => {
        if (button.dataset.gameRoute === 'marble') void import('../marble/MarbleApp');
        if (button.dataset.gameRoute !== 'bowling') return;
        void import('../ui/DesktopApp');
        void import('@dimforge/rapier3d-compat');
      };
      button.addEventListener('pointerenter', warmGame, { once: true });
      button.addEventListener('focus', warmGame, { once: true });
      button.addEventListener('click', () => {
        button.classList.add('is-launching');
        button.querySelector('span')!.textContent = 'ĐANG MỞ SÂN…';
        const url = new URL(location.href);
        url.search = '';
        url.searchParams.set('game', button.dataset.gameRoute!);
        location.assign(url);
      });
    });
  }

  private gameArt(game: GameCatalogItem): string {
    if (game.id === 'marble') {
      return `<div class="hub-game-art hub-game-art--marble" aria-hidden="true">
        <div class="hub-marble-track"><i></i><i></i><i></i></div>
        <span class="hub-marble hub-marble--a"></span><span class="hub-marble hub-marble--b"></span><span class="hub-marble hub-marble--c"></span>
        <span class="hub-live-badge">MỚI</span>
      </div>`;
    }
    return `<div class="hub-game-art" aria-hidden="true">
        <div class="hub-lane-glow"></div>
        <div class="hub-pin-rack">
          <i></i><i></i><i></i><i></i><i></i><i></i>
        </div>
        <div class="hub-bowling-ball"><b></b><b></b><b></b></div>
        <span class="hub-live-badge">SẴN SÀNG</span>
      </div>`;
  }

  private gameCard(game: GameCatalogItem): string {
    return `<article class="hub-game-card hub-game-card--${game.id}">
      ${this.gameArt(game)}
      <div class="hub-game-copy">
        <span class="hub-card-eyebrow">${game.eyebrow}</span>
        <h2>${game.title}</h2>
        <p>${game.description}</p>
        <div class="hub-tags">${game.tags.map((tag) => `<span>${tag}</span>`).join('')}</div>
        <button class="hub-play-button" data-game-route="${game.route}"><span>CHƠI NGAY</span><b>→</b></button>
      </div>
    </article>`;
  }

  private template(): string {
    const availableGames = GAME_CATALOG.filter((game) => game.available);
    return `<main class="hub-shell">
      <div class="hub-orb hub-orb-one"></div><div class="hub-orb hub-orb-two"></div>
      <header class="hub-header">
        <a class="hub-brand" href="./" aria-label="Pocket Arcade">
          <span class="hub-brand-mark"><i></i><i></i><i></i></span>
          <span><strong>POCKET</strong><b>ARCADE</b></span>
        </a>
        <div class="hub-header-actions">
          <button class="theme-toggle hub-theme-toggle" data-theme-toggle type="button"><span data-theme-icon aria-hidden="true">☀</span><span data-theme-label>Chế độ sáng</span></button>
          <div class="hub-library-count"><i></i>${availableGames.length} GAME ĐANG CÓ</div>
        </div>
      </header>

      <section class="hub-library hub-library--compact" aria-labelledby="library-title">
        <ol class="hub-steps" aria-label="Cách chơi cùng nhau">
          <li><b>1</b><span><strong>Mở game trên TV hoặc laptop</strong><small>Màn hình lớn là sân chung</small></span></li>
          <li><b>2</b><span><strong>Mọi người quét mã QR</strong><small>Không cài app, không cần tài khoản</small></span></li>
          <li><b>3</b><span><strong>Cùng chơi trên một màn hình</strong><small>Mỗi điện thoại là một người chơi</small></span></li>
        </ol>
        <div class="hub-section-heading"><div><span>KHO GAME</span><h1 id="library-title">Chọn game để bắt đầu</h1></div><p>${availableGames.length} game đang có</p></div>
        <div class="hub-game-grid">
          ${availableGames.map((game) => this.gameCard(game)).join('')}
        </div>
      </section>

      <footer class="hub-footer"><span>POCKET ARCADE</span><p>${availableGames.map((game) => game.title).join(' · ')}</p></footer>
    </main>`;
  }
}
