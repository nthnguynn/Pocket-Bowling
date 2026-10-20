import './styles.css';
import { initTheme } from './ui/theme';

initTheme();

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Không tìm thấy #app');

const params = new URLSearchParams(location.search);
const isController = params.get('controller') === '1';
const selectedGame = params.get('game');
if (isController) {
  document.body.classList.add('controller-page');
  if (selectedGame === 'marble') {
    document.title = 'Pocket Marble · Tay cầm';
    const { MarblePhoneApp } = await import('./marble/MarblePhoneApp');
    new MarblePhoneApp(root);
  } else {
    const { PhoneApp } = await import('./ui/PhoneApp');
    new PhoneApp(root);
  }
} else if (selectedGame === 'marble') {
  const { MarbleApp } = await import('./marble/MarbleApp');
  new MarbleApp(root);
} else if (selectedGame === 'bowling') {
  document.title = 'Pocket Bowling';
  root.innerHTML = '<div class="loading-screen"><div class="loading-ball"></div><strong>Đang dựng sân…</strong><span>Khởi tạo Rapier + Three.js</span></div>';
  const [{ default: RAPIER }, { DesktopApp }] = await Promise.all([
    import('@dimforge/rapier3d-compat'),
    import('./ui/DesktopApp'),
  ]);
  await RAPIER.init();
  new DesktopApp(root);
} else {
  const { ArcadeHub } = await import('./ui/ArcadeHub');
  new ArcadeHub(root);
}
