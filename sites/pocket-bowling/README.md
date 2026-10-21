# Bowling

Bowling 3D (Three.js + vật lý Rapier). Chơi theo lượt, 1–6 người; số người đặt trong `src/meta.ts`.

Chạy (ở gốc repo): `npm run dev:bowling` rồi mở `http://localhost:5174` trên TV/laptop; điện thoại quét QR (trang `?controller=1` của chính site này). Test riêng site: `npx vitest run sites/pocket-bowling`.

## Cách chơi

- Chọn **Một mình / Hai người** để chơi trên máy này, hoặc bắt đầu party với các điện thoại đã quét mã: mỗi điện thoại là một người, bóng đổi màu theo người tới lượt, TV hiện tên người tới lượt thật to, chỉ điện thoại của người đó ném được. Máy chủ vẫn ném hộ được nếu một điện thoại rớt mạng.

- Laptop: chọn 1 hoặc 2 người. Dùng thanh trượt hoặc `A/D` (vị trí), `Q/E` (hướng), `Z/C` (xoáy), `W/S` (lực). Giữ rồi thả `Space` để ném.
- Góc nhìn: chọn trực tiếp **Tự động**, **Theo bóng**, **Ngang sân**, **Sau chai** hoặc **Trên cao** ở cạnh trái; nhấn `V` để chuyển nhanh qua các góc.
- Điện thoại: bấm **Điện thoại** trên laptop, quét QR, rồi chọn Cảm ứng hoặc Chuyển động.
- Nút **Đồ họa** mặc định ở chế độ Tự động: game theo dõi nhịp khung hình và tự cân bằng độ nét, bóng đổ để giữ trải nghiệm ổn định. Có thể chuyển sang Cao hoặc Nhẹ bất kỳ lúc nào.
- Khi tay cầm đã kết nối, màn hình điện thoại tự thu gọn phần ghép nối, ưu tiên vùng điều khiển và cố giữ màn hình sáng nếu trình duyệt hỗ trợ Wake Lock.
- Va chạm, bóng vào rãnh và kết quả từng lượt có phản hồi âm thanh/hình ảnh tức thì; trạng thái chơi vẫn được quyết định bởi mô phỏng vật lý trên laptop.
- Test/build: `npm test` và `npm run build`.

## Xử lý chuyển động (ném bằng cách vung điện thoại)

Controller không cố suy ra vị trí bàn tay trong không gian. Nó dùng acceleration đã bỏ gravity khi trình duyệt cung cấp, low-pass filter, peak + tích phân cường độ để ước lượng lực; tốc độ quay và góc nghiêng đã hiệu chỉnh để ước lượng xoáy. Sample được giới hạn khoảng 30 Hz. Gesture cần vượt ngưỡng, có cửa sổ kết thúc và cooldown 1,4 giây để không phát hai cú ném. Input cuối cùng vẫn được clamp và xác thực lại ở laptop.

## Module

- `src/game/PhysicsLane.ts`: world Rapier, collider, fixed timestep, hook xoáy và phát hiện chai ngã.
- `src/game/BowlingRenderer.ts`: sân, bóng, chai, ánh sáng, texture procedural và camera.
- `src/game/GameSession.ts` + `scoring.ts`: state machine, 10 frame, strike/spare/open và frame 10.
- `src/input/DesktopInput.ts`: bàn phím, chuột và cơ chế giữ/thả lấy lực.
- `src/controller/MotionController.ts`: xin quyền, hiệu chỉnh, low-pass filter, peak/impulse, cooldown.
- `src/protocol.ts`: lệnh `throw`/`aim`/`prepare`/`cancel` và parser kẹp giá trị vào miền an toàn.
- `src/ui/DesktopApp.ts`, `src/ui/PhoneApp.ts`: màn hình chính (HUD, bảng chẩn đoán mạng) và tay cầm.

## Test (`tests/`)

Perfect game 300; toàn spare, toàn trượt; chuỗi strike/spare/open và frame 10; state gate, command ID trùng, giữ/reset rack; vector ném thay đổi theo lực/góc; xoay vòng lượt 3 người, báo hòa; kiểm tra lệnh ném qua mạng.
