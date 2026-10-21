import type { SiteMeta } from '@pocket/party-kit';

/** Thông tin game này cho trang kho game, và giới hạn số người chơi mà chính game dùng. */
export const meta: SiteMeta = {
  id: 'sumo',
  title: 'Sumo',
  eyebrow: 'PARTY BRAWL',
  description: 'Cả nhóm cùng lúc lên sàn, húc nhau rơi khỏi đài trong khi sàn sụp dần. Rơi rồi vẫn quậy được: hóa hồn ma thổi bay người còn trụ.',
  tags: ['Chỉ cần cảm ứng', 'Vào là chạy thử ngay'],
  // Mọi người đấu cùng lúc nên đông vui hơn; bàn phím chung tối đa 3 người cho đỡ chật tay.
  players: { max: 8, local: [1, 2, 3] },
  devPort: 5176,
};
