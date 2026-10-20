# Pocket Marble

Đua bi, mỗi người một làn, 1–8 người (`src/meta.ts`).

Chạy (ở gốc repo): `npm run dev:marble` rồi mở `http://localhost:5175` trên TV/laptop; điện thoại quét QR (trang `?controller=1` của chính site này). Test riêng site: `npx vitest run sites/pocket-marble`.

## Cách chơi

Lấy cảm hứng từ [Give Me Toilet Paper!](https://www.techbang.com/posts/112777-tpgs-2024-give-me-toilet-paper) (Switch, 2023: nhét Joy-Con vào cuộn giấy đặt trên tấm bìa, nghiêng tấm bìa để lái cuộn giấy), nhưng dùng viên bi:

- **Điện thoại là tấm khay**: nghiêng trái/phải để lái viên bi trên TV, chạm khay để nhảy qua hố. Không có cảm biến (hoặc trang không chạy HTTPS) thì dùng nút ◀ NHẢY ▶.
- **Giữ bi trên khay**: tương ứng với việc giữ cuộn giấy thật khỏi lăn khỏi tấm bìa. Nghiêng vừa phải thì bi trong khay nằm yên; giữ nghiêng hết cỡ khoảng 2 giây thì bi lăn ra mép và rơi, viên bi trên TV bị choáng 1,2 giây. TV tính khay theo độ nghiêng nhận được; điện thoại chỉ hiển thị bản dự đoán.
- **Đường đua**: mỗi người một làn, cùng một đường sinh theo seed (công bằng): khối chắn, hành lang hẹp, khối trượt, hố (có khe hoặc chắn ngang phải nhảy), tấm tăng tốc và ngọc.
- **3 mạng**: rơi hố hoặc làm rơi bi khỏi khay mất 1 mạng (rơi hố thì được đặt lại trước hố). Hết mạng là bị loại: làn tối lại, xếp sau mọi người còn đua. Đâm khối chắn chỉ bị bật lại, không mất mạng.
- **Thắng thua**: người đầu tiên về đích kích hoạt 20 giây cho những người còn lại; ai cũng về đích hoặc bị loại thì kết thúc luôn. Thành tích = thời gian − 0,5 giây × số ngọc. Chơi một mình có 2 bot đua cùng; bot kém thỉnh thoảng lỡ hố nên cũng có thể bị loại.
- Chơi trên máy này: P1 `←` `→` lái, `↑`/`Space` nhảy; P2 `A` `D`, `W`; P3 `J` `L`, `I`.
- Độ nghiêng gửi ~30 lần/giây qua kênh telemetry (không đảm bảo thứ tự, mẫu cũ bị bỏ); lệnh nhảy qua kênh tin cậy.

## Module

- `src/course.ts`: sinh đường đua theo seed (dùng `mulberry32` của party-kit), luôn có khe lăn qua hoặc hố nhảy được.
- `src/physics.ts`: vật lý viên bi + khay trên điện thoại.
- `src/MarbleRace.ts`: luật đua, 3 mạng, ân hạn, xếp hạng.
- `src/bot.ts`: bot nhìn trước, né khối, nhảy hố; bot kém thỉnh thoảng lỡ hố.
- `src/MarbleRenderer.ts`: canvas nhiều làn (8 làn vẫn đọc được tên).
- `src/MarbleApp.ts`, `src/MarblePhoneApp.ts`, `src/protocol.ts` (lệnh `jump`).

## Test (`tests/`)

Đường sinh theo seed luôn đi được; rơi hố/nhảy qua hố; va khối; nhặt ngọc; khay rơi bi khi nghiêng gắt quá lâu; 3 mạng, hết mạng bị loại và xếp cuối; luật về đích + ân hạn; bot về đích trên nhiều seed, bot kém có lúc rơi hố.
