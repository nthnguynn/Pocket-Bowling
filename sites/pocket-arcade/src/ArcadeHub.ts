import { bindThemeToggle, type SiteMeta } from '@pocket/party-kit';
import { GAMES, playerCountLabel, siteUrl } from './catalog';

export class ArcadeHub {
  constructor(private readonly root: HTMLElement) {
    document.title = 'Pocket Arcade — Kho game';
    document.body.classList.add('hub-page');
    this.root.innerHTML = this.template();
    this.bind();
  }

  private bind(): void {
    bindThemeToggle(this.root);
    this.root.querySelectorAll<HTMLAnchorElement>('[data-game-link]').forEach((link) => {
      link.addEventListener('click', () => {
        link.classList.add('is-launching');
        link.querySelector('span')!.textContent = 'ĐANG MỞ SÂN…';
      });
    });
  }

  private gameArt(game: SiteMeta): string {
    if (game.id === 'roll') {
      return `<div class="hub-game-art hub-game-art--roll" aria-hidden="true">
        <div class="hub-roll-board"></div>
        <span class="hub-roll-saw"></span>
        <span class="hub-roll"><b></b></span>
        <span class="hub-roll-wc">WC</span>
        <span class="hub-live-badge">MỚI</span>
      </div>`;
    }
    if (game.id === 'sumo') {
      return `<div class="hub-game-art hub-game-art--sumo" aria-hidden="true">
        <div class="hub-sumo-ring"></div>
        <span class="hub-sumo hub-sumo--a"><b></b></span><span class="hub-sumo hub-sumo--b"><b></b></span>
        <span class="hub-sumo-bang">BỐP!</span>
        <span class="hub-live-badge">SẴN SÀNG</span>
      </div>`;
    }
    if (game.id === 'marble') {
      return `<div class="hub-game-art hub-game-art--marble" aria-hidden="true">
        <div class="hub-marble-track"><i></i><i></i><i></i></div>
        <span class="hub-marble hub-marble--a"></span><span class="hub-marble hub-marble--b"></span><span class="hub-marble hub-marble--c"></span>
        <span class="hub-live-badge">SẴN SÀNG</span>
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

  private gameCard(game: SiteMeta): string {
    return `<article class="hub-game-card hub-game-card--${game.id}">
      ${this.gameArt(game)}
      <div class="hub-game-copy">
        <span class="hub-card-eyebrow">${game.eyebrow}</span>
        <h2>${game.title}</h2>
        <p>${game.description}</p>
        <div class="hub-tags">${[playerCountLabel(game.players), ...game.tags].map((tag) => `<span>${tag}</span>`).join('')}</div>
        <a class="hub-play-button" data-game-link href="${siteUrl(game)}"><span>CHƠI NGAY</span><b>→</b></a>
      </div>
    </article>`;
  }

  private template(): string {
    const availableGames = GAMES;
    return `<main class="hub-shell">
      <div class="hub-orb hub-orb-one"></div><div class="hub-orb hub-orb-two"></div>
      <header class="hub-header">
        <a class="hub-brand" href="./" aria-label="Pocket Arcade">
          <span class="hub-brand-mark"><i></i><i></i><i></i></span>
          <span><strong>POCKET</strong><b>ARCADE</b></span>
        </a>
        <div class="hub-header-actions">
          <button class="theme-toggle hub-theme-toggle" data-theme-toggle type="button"><span data-theme-icon aria-hidden="true"></span><span data-theme-label>Chế độ sáng</span></button>
          <div class="hub-library-count"><i></i>${availableGames.length} GAME ĐANG CÓ</div>
        </div>
      </header>

      <section class="hub-library hub-library--compact" aria-labelledby="library-title">
        <div class="hub-section-heading"><div><span>KHO GAME</span><h1 id="library-title">Chọn game để bắt đầu</h1></div><p>${availableGames.length} game đang có</p></div>
        <div class="hub-game-grid">
          ${availableGames.map((game) => this.gameCard(game)).join('')}
        </div>
      </section>

      <footer class="hub-footer"><span>POCKET ARCADE</span><p>${availableGames.map((game) => game.title).join(' · ')}</p></footer>
    </main>`;
  }
}
