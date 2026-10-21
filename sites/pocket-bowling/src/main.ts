import '@pocket/party-kit/styles.css';
import './styles.css';
import { initTheme } from '@pocket/party-kit';

initTheme();

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Không tìm thấy #app');

// Cùng một site: ?controller=1 là trang tay cầm trên điện thoại, không có là sân trên màn hình chính.
if (new URLSearchParams(location.search).get('controller') === '1') {
  document.body.classList.add('controller-page');
  document.title = 'Bowling · Tay cầm';
  const { PhoneApp } = await import('./ui/PhoneApp');
  new PhoneApp(root);
} else {
  root.innerHTML = '<div class="loading-screen"><div class="loading-ball"></div><strong>Đang dựng sân…</strong><span>Khởi tạo Rapier + Three.js</span></div>';
  const [{ default: RAPIER }, { DesktopApp }] = await Promise.all([
    import('@dimforge/rapier3d-compat'),
    import('./ui/DesktopApp'),
  ]);
  await RAPIER.init();
  new DesktopApp(root);
}
