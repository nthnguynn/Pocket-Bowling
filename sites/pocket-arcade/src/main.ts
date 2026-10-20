import '@pocket/party-kit/styles.css';
import './styles.css';
import { initTheme } from '@pocket/party-kit';
import { ArcadeHub } from './ArcadeHub';

initTheme();

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Không tìm thấy #app');
new ArcadeHub(root);
