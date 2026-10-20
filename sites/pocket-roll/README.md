# Pocket Roll

Lấy cảm hứng từ *Give Me Toilet Paper!*: điện thoại là tấm bìa, nghiêng để lăn cuộn giấy qua từng màn tới nhà vệ sinh. 10 màn khó dần, 1–8 người (`src/meta.ts`).

Chạy (ở gốc repo): `npm run dev:roll` rồi mở `http://localhost:5177` trên TV/laptop; điện thoại quét QR (trang `?controller=1` của chính site này). Test riêng site: `npx vitest run sites/pocket-roll`.

## Cách chơi

- **Điều khiển**: cầm điện thoại như cầm tấm bìa, nghiêng trái/phải để lăn; chạm màn hình để nhảy. Lần chạm đầu bật cảm biến nghiêng (iPhone hỏi quyền). Không có cảm biến hoặc trang không chạy HTTPS thì dùng nút ◀ NHẢY ▶. Trên điện thoại có thước thủy: bọt nằm giữa là đang cân.
- **Mỗi màn gọn một khung hình**, mọi người lăn cùng lúc trên cùng một màn. Chạm cưa là rách giấy, rơi xuống nước hay rơi khỏi màn cũng chết; chết thì sống lại ở cờ gần nhất (hoặc chỗ xuất phát).
- **Điểm**: giao giấy thứ nhất 5 điểm, thứ hai 3, thứ ba 2, còn lại 1. Người đầu tiên giao xong kích hoạt 25 giây cho những người còn lại; mỗi màn tối đa 150 giây.
- **Qua màn**: có người qua thì tự sang màn sau sau 9 giây; chưa ai qua thì chơi lại màn đó. Chủ phòng bấm **Màn tiếp** / **Chơi lại màn** ngay trên điện thoại. Hết 10 màn thì xếp theo tổng điểm.
- **Lăn thử ở sảnh**: chọn màn bắt đầu ở sảnh chờ; ai quét mã là có cuộn giấy lăn thử ngay màn đó. Màn đã qua có dấu ✓ (lưu trên TV).
- Chơi trên máy này: P1 `←` `→` nghiêng, `↑`/`Space` nhảy; P2 `A` `D`, `W`.

| Màn | Tên | Thử thách mới |
| --- | --- | --- |
| 1 | Lăn thử | nghiêng hai chiều trên dốc |
| 2 | Lưỡi cưa đầu tiên | nhảy qua cưa và khe |
| 3 | Bập bênh | bập bênh nghiêng theo cuộn giấy, nước bên dưới |
| 4 | Bục trôi | đứng yên cho bục chở qua hố cưa |
| 5 | Quạt gió | bay lên theo luồng gió, cưa lên xuống |
| 6 | Đệm nảy | bật cao bằng đệm, cưa trên đầu |
| 7 | Cưa lên xuống | canh nhịp cưa, cờ lưu chỗ |
| 8 | Dầm hẹp | nhảy liên tiếp qua các khe |
| 9 | Bập bênh đôi | cân bằng trên hai bập bênh |
| 10 | Tổng duyệt | đủ cả bục trôi, quạt, cưa, bập bênh |

## Module

- `src/physics.ts`: vật lý cuộn giấy (lăn dọc mặt sàn, nhảy, va chạm bục dạng đoạn thẳng), bục di chuyển, bập bênh, quạt, đệm nảy, cưa, nước, cờ.
- `src/levels.ts`: 10 màn, mỗi màn kèm `route` cho bot.
- `src/bot.ts`: bot đi theo route, canh cưa chạy, chờ bục tới rồi bước lên.
- `src/RollMatch.ts`: đếm ngược, điểm, ân hạn, qua màn/chơi lại, sàn lăn thử.
- `src/RollRenderer.ts`, `src/RollAudio.ts`, `src/RollApp.ts`, `src/RollPhoneApp.ts`, `src/protocol.ts` (lệnh `jump`, sự kiện rung).

## Test (`tests/`)

Bot qua được cả 10 màn (bằng chứng màn nào cũng có đường tới đích); lăn/dừng; cưa, nước, rơi khỏi màn; nhảy qua cưa; cờ lưu chỗ; quạt, đệm nảy, bập bênh, bục chở; điểm theo thứ tự, ân hạn, chơi lại khi chưa ai qua, hết trận; sàn lăn thử; kiểm tra lệnh nhảy qua mạng.
