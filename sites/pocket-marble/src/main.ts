import '@pocket/party-kit/styles.css';
import './styles.css';
import { initTheme } from '@pocket/party-kit';

initTheme();

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Không tìm thấy #app');

// Cùng một site: ?controller=1 là trang tay cầm trên điện thoại, không có là màn hình chính (TV/laptop).
if (new URLSearchParams(location.search).get('controller') === '1') {
  document.body.classList.add('controller-page');
  document.title = 'Pocket Marble · Tay cầm';
  const { MarblePhoneApp } = await import('./MarblePhoneApp');
  new MarblePhoneApp(root);
} else {
  const { MarbleApp } = await import('./MarbleApp');
  new MarbleApp(root);
}
