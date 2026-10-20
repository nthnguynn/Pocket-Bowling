import type { SiteMeta } from '@pocket/party-kit';

/** Thông tin game này cho trang kho game, và giới hạn số người chơi mà chính game dùng. */
export const meta: SiteMeta = {
  id: 'roll',
  title: 'Pocket Roll',
  eyebrow: 'BALANCE PUZZLE',
  description: 'Lấy cảm hứng từ Give Me Toilet Paper!: điện thoại là tấm bìa, nghiêng để lăn cuộn giấy qua cưa, bập bênh, quạt gió tới nhà vệ sinh. 10 màn khó dần, cả nhóm đua giao giấy.',
  tags: ['Nghiêng điện thoại', '10 màn'],
  // Mỗi màn gọn một khung hình, 8 cuộn giấy vẫn nhìn rõ; bàn phím chung 2 người cho đỡ chật tay.
  players: { max: 8, local: [1, 2] },
  devPort: 5177,
};
