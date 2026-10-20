import type { SiteMeta } from '@pocket/party-kit';

/** Thông tin game này cho trang kho game, và giới hạn số người chơi mà chính game dùng. */
export const meta: SiteMeta = {
  id: 'marble',
  title: 'Pocket Marble',
  eyebrow: 'PARTY RACE',
  description: 'Lấy cảm hứng từ Give Me Toilet Paper!: điện thoại là tấm khay, nghiêng để lái viên bi qua hố và chướng ngại. Mỗi người một làn, cùng đua trên TV.',
  tags: ['Nghiêng điện thoại', 'Có bot khi chơi một mình'],
  // Đua cùng lúc, mỗi người một làn; bàn phím chung tối đa 3 người cho đỡ chật tay.
  players: { max: 8, local: [1, 2, 3] },
  devPort: 5175,
};
