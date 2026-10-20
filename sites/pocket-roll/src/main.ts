import '@pocket/party-kit/styles.css';
import './styles.css';
import { initTheme } from '@pocket/party-kit';

initTheme();

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Không tìm thấy #app');

// Cùng một site: ?controller=1 là trang tay cầm trên điện thoại, không có là màn hình chính (TV/laptop).
if (new URLSearchParams(location.search).get('controller') === '1') {
  document.body.classList.add('controller-page');
  document.title = 'Pocket Roll · Tay cầm';
  const { RollPhoneApp } = await import('./RollPhoneApp');
  new RollPhoneApp(root);
} else {
  const { RollApp } = await import('./RollApp');
  new RollApp(root);
}
