export type GameCatalogItem = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  tags: string[];
  route: string;
  available: boolean;
};

export const GAME_CATALOG: GameCatalogItem[] = [
  {
    id: 'bowling',
    title: 'Pocket Bowling',
    eyebrow: '3D ARCADE',
    description: 'Bowling 3D với vật lý chân thực, nhiều góc camera. Mở trên TV, cả nhóm quét QR và dùng điện thoại làm tay cầm.',
    tags: ['1–6 người', 'Quét QR là chơi', 'Điện thoại làm tay cầm'],
    route: 'bowling',
    available: true,
  },
  {
    id: 'marble',
    title: 'Pocket Marble',
    eyebrow: 'PARTY RACE',
    description: 'Lấy cảm hứng từ Give Me Toilet Paper!: điện thoại là tấm khay, nghiêng để lái viên bi qua hố và chướng ngại. Mỗi người một làn, cùng đua trên TV.',
    tags: ['1–6 người', 'Nghiêng điện thoại', 'Có bot khi chơi một mình'],
    route: 'marble',
    available: true,
  },
];
