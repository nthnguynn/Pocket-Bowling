# Pocket Sumo

Đấu sumo: cả nhóm cùng lúc húc nhau rơi khỏi đài, 1–8 người (`src/meta.ts`). Chỉ cần cảm ứng, không cần HTTPS.

Chạy (ở gốc repo): `npm run dev:sumo` rồi mở `http://localhost:5176` trên TV/laptop; điện thoại quét QR (trang `?controller=1` của chính site này). Test riêng site: `npx vitest run sites/pocket-sumo`.

## Cách chơi

Cả nhóm cùng lúc lên một sàn tròn, húc nhau rơi khỏi đài. Không ai phải chờ lượt.

- **Chỉ cần cảm ứng**: cả màn hình điện thoại là cần điều khiển nổi. Đặt ngón cái ở đâu thì cần hiện ở đó (kéo quá xa thì vòng gốc chạy theo), **vuốt nhanh rồi thả** để húc, hoặc chạm thêm ngón thứ hai để húc theo hướng đang chạy. Không cần cảm biến, nên chạy được cả khi trang không có HTTPS.
- **Sàn khởi động**: ở sảnh chờ, sảnh thu gọn bên trái TV; ai quét mã là nhân vật rơi xuống sàn bên phải và điều khiển thử được ngay (có bao cát khi phòng ít người). Chạm vào điện thoại thì vòng sáng dưới chân nhân vật trên TV nháy lên để nhận ra mình.
- **Một vòng**: vòng ngoài nhấp nháy đỏ 3 giây rồi sụp (từ giây 14, rồi cứ 9 giây một lần) cho tới bán kính tối thiểu, sau đó sàn co dần tới khi chỉ còn một người. Người cuối cùng trụ lại thắng vòng; thắng 3 vòng trước thì thắng trận. Các vòng lần lượt là sàn gỗ, sàn băng (trượt dài) và cột nảy.
- **Rơi rồi vẫn chơi**: người rơi hóa hồn ma, bay tự do và vuốt để *thổi* người còn sống (hồi chiêu 2,6 giây). Cú va/thổi gần nhất trong 2,5 giây được tính là hất văng (KO).
- **Phản hồi trên điện thoại**: rung khi bị húc, húc trúng, rơi, KO, thắng vòng, sàn sắp sụp và khi hồi chiêu xong; khung vùng chạm nháy/rung theo để vẫn có phản hồi trên iPhone (web không rung được trên iOS). Sát mép thì viền đỏ đập theo nhịp.
- Điện thoại rớt mạng giữa trận thì bot đánh hộ tới khi nối lại. Chơi một mình có 2 bot.
- Chơi trên máy này: P1 `←↑↓→` chạy, `Enter` húc (một mình thì `Space` cũng được); P2 `WASD`, `F`; P3 `IJKL`, `O`.
- Hướng cần gửi ~30 lần/giây qua kênh telemetry (mẫu cũ bị bỏ, quá 0,5 giây không có mẫu thì coi như buông tay); lệnh húc qua kênh tin cậy, TV giữ lệnh tới sớm hơn hồi chiêu tối đa 0,2 giây.

## Module

- `src/physics.ts`: va chạm 2D, húc, hồi chiêu, cột nảy, rơi mép, hồn ma thổi.
- `src/SumoMatch.ts`: vòng/trận, sàn sụp dần, sàn khởi động ở sảnh, bot đánh hộ khi rớt mạng.
- `src/bot.ts`, `src/SumoRenderer.ts` (canvas giả 3D), `src/SumoAudio.ts`.
- `src/JoystickPad.ts`: cần điều khiển nổi toàn màn hình, vuốt để húc, ngón thứ hai để húc.
- `src/SumoApp.ts`, `src/SumoPhoneApp.ts`, `src/protocol.ts` (lệnh `dash`, sự kiện rung).

## Test (`tests/`)

Chạy/dừng, húc văng, húc trực diện, hồi chiêu + giữ lệnh sớm, rơi mép và tính KO, hồn ma thổi, đếm ngược, cảnh báo rồi mới sụp sàn, thắng vòng/thắng trận/hòa, đổi kiểu sàn, sàn khởi động, bot đánh hộ, 8 người không chồng nhau, trận toàn bot luôn kết thúc, kiểm tra lệnh húc qua mạng.
