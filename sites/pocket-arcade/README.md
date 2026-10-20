# Pocket Arcade — kho game

Trang chọn game (cổng 5173). Không chứa code game nào: thẻ game được dựng từ `@pocket/<game>/meta` của từng site (`src/catalog.ts`), nút **Chơi ngay** mở site của game đó.

- Khi dev, link trỏ tới cùng máy, cổng dev của từng site (`devPort` trong meta).
- Khi deploy, đặt `VITE_SITE_<ID>_URL` (ví dụ `VITE_SITE_ROLL_URL=https://roll.example.com/`) trong `.env` ở gốc repo.
- Thêm game: thêm một dòng import + một phần tử trong `GAMES` ở `src/catalog.ts`. Test `tests/catalog.test.ts` kiểm tra số người chơi và cổng của mọi game.
