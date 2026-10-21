import type { SiteMeta } from '@pocket/party-kit';

/** Thông tin game này cho trang kho game, và giới hạn số người chơi mà chính game dùng. */
export const meta: SiteMeta = {
  id: 'bowling',
  title: 'Bowling',
  eyebrow: '3D ARCADE',
  description: 'Bowling 3D với vật lý chân thực, nhiều góc camera. Mở trên TV, cả nhóm quét QR và dùng điện thoại làm tay cầm.',
  tags: ['Quét QR là chơi', 'Điện thoại làm tay cầm'],
  // Theo lượt, mỗi người 10 frame: đông quá thì chờ lâu và bảng điểm chật.
  players: { max: 6, local: [1, 2] },
  devPort: 5174,
};
