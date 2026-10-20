# Pocket Arcade

Kho game party trên web, hiện có **Pocket Bowling** và **Pocket Marble**. Cách chơi chung của cả kho:

1. Mở game trên TV hoặc laptop (màn hình chính).
2. Mọi người quét mã QR bằng điện thoại — không cài app, không cần tài khoản.
3. Cùng chơi trên một màn hình; mỗi điện thoại là một người chơi (tối đa 6).

Điện thoại nối với màn hình chính qua **WebRTC DataChannel**. Màn hình chính là nguồn trạng thái duy nhất: vật lý, lượt chơi và điểm số đều được tính ở đó; điện thoại chỉ gửi input.

## Chạy nhanh

Yêu cầu: Node.js 20+ và npm.

```bash
npm install
npm run dev
```

Mở `http://localhost:5173` để vào kho game. Bowling có URL `?game=bowling`, Marble là `?game=marble`; signaling chạy tại `ws://localhost:8787`.

- Thêm game mới: khai báo metadata trong `src/hub/gameCatalog.ts`, tạo module game tương ứng và thêm nhánh tải động trong `src/main.ts` (cả trang màn hình chính lẫn trang tay cầm `?game=...&controller=1`). Sảnh chờ dùng chung: `HostLobby` (màn hình chính), `PhoneConnection` + `PhoneSeat` (điện thoại), `PartyRoom` (ai giữ ghế nào).

## Chế độ party (mọi game)

- Màn hình chính mở sảnh chờ ngay khi vào game: QR lớn, mã phòng, danh sách người chơi. Mỗi điện thoại quét QR là xuất hiện ngay với một màu riêng; tên là tùy chọn (để trống thì là "Người chơi N"), lưu trên máy.
- Người vào đầu tiên là **chủ phòng**: bấm bắt đầu/chơi lại ngay trên điện thoại, không cần chạm vào TV. TV vẫn có nút bắt đầu riêng.
- Danh tính theo từng tab (`sessionStorage`): tải lại trang hoặc mở khóa màn hình thì tự vào lại đúng ghế; mở tab khác là một người chơi khác (tiện thử nhiều "điện thoại" trên một máy).
- Mất kết nối giữa ván thì ghế được giữ và TV ghi "mất kết nối"; người vào giữa ván sẽ chơi từ ván sau.
- Signaling cho tối đa `MAX_CONTROLLERS` (mặc định 8) điện thoại mỗi phòng: 6 người chơi + chỗ cho máy xem/kết nối lại.

## Pocket Bowling

- Chọn **Một mình / Hai người** để chơi trên máy này, hoặc bắt đầu party với các điện thoại đã quét mã: mỗi điện thoại là một người, bóng đổi màu theo người tới lượt, TV hiện tên người tới lượt thật to, chỉ điện thoại của người đó ném được. Máy chủ vẫn ném hộ được nếu một điện thoại rớt mạng.

- Laptop: chọn 1 hoặc 2 người. Dùng thanh trượt hoặc `A/D` (vị trí), `Q/E` (hướng), `Z/C` (xoáy), `W/S` (lực). Giữ rồi thả `Space` để ném.
- Góc nhìn: chọn trực tiếp **Tự động**, **Theo bóng**, **Ngang sân**, **Sau chai** hoặc **Trên cao** ở cạnh trái; nhấn `V` để chuyển nhanh qua các góc.
- Điện thoại: bấm **Điện thoại** trên laptop, quét QR, rồi chọn Cảm ứng hoặc Chuyển động.
- Nút **Đồ họa** mặc định ở chế độ Tự động: game theo dõi nhịp khung hình và tự cân bằng độ nét, bóng đổ để giữ trải nghiệm ổn định. Có thể chuyển sang Cao hoặc Nhẹ bất kỳ lúc nào.
- Khi tay cầm đã kết nối, màn hình điện thoại tự thu gọn phần ghép nối, ưu tiên vùng điều khiển và cố giữ màn hình sáng nếu trình duyệt hỗ trợ Wake Lock.
- Va chạm, bóng vào rãnh và kết quả từng lượt có phản hồi âm thanh/hình ảnh tức thì; trạng thái chơi vẫn được quyết định bởi mô phỏng vật lý trên laptop.
- Test/build: `npm test` và `npm run build`.

## Pocket Marble

Lấy cảm hứng từ [Give Me Toilet Paper!](https://www.techbang.com/posts/112777-tpgs-2024-give-me-toilet-paper) (Switch, 2023: nhét Joy-Con vào cuộn giấy đặt trên tấm bìa, nghiêng tấm bìa để lái cuộn giấy), nhưng dùng viên bi:

- **Điện thoại là tấm khay**: nghiêng trái/phải để lái viên bi trên TV, chạm khay để nhảy qua hố. Không có cảm biến (hoặc trang không chạy HTTPS) thì dùng nút ◀ NHẢY ▶.
- **Giữ bi trên khay**: tương ứng với việc giữ cuộn giấy thật khỏi lăn khỏi tấm bìa. Nghiêng vừa phải thì bi trong khay nằm yên; giữ nghiêng hết cỡ khoảng 2 giây thì bi lăn ra mép và rơi, viên bi trên TV bị choáng 1,2 giây. TV tính khay theo độ nghiêng nhận được; điện thoại chỉ hiển thị bản dự đoán.
- **Đường đua**: mỗi người một làn, cùng một đường sinh theo seed (công bằng): khối chắn, hành lang hẹp, khối trượt, hố (có khe hoặc chắn ngang phải nhảy), tấm tăng tốc và ngọc.
- **Thắng thua**: người đầu tiên về đích kích hoạt 20 giây cho những người còn lại. Thành tích = thời gian − 0,5 giây × số ngọc. Chơi một mình có 2 bot đua cùng.
- Chơi trên máy này: P1 `←` `→` lái, `↑`/`Space` nhảy; P2 `A` `D`, `W`.
- Độ nghiêng gửi ~30 lần/giây qua kênh telemetry (không đảm bảo thứ tự, mẫu cũ bị bỏ); lệnh nhảy qua kênh tin cậy.

## Kiến trúc

```text
┌────────────────── LAPTOP / HOST ──────────────────┐
│ Three.js renderer ← fixed-step Rapier physics     │
│          ↑            ↑                           │
│ HUD / scoring ← game state machine ← validated input
│                                      ↑            │
│                         WebRTC DataChannel host    │
└──────────────────────────────┬─────────────────────┘
                               │ SCTP / DTLS / ICE
                       direct UDP or TURN relay
                               │
┌──────────────────────────────┴─────────────────────┐
│ PHONE / CONTROLLER                                │
│ touch controls · filtered motion · rate limiting │
│ reliable command channel + lossy telemetry       │
└────────────────────────────────────────────────────┘

         WebSocket signaling server (port 8787)
       exchanges SDP + ICE candidates, then leaves
          gameplay traffic on WebRTC DataChannel
```

Các module chính:

- `src/game/PhysicsLane.ts`: world Rapier, collider, fixed timestep, hook xoáy và phát hiện chai ngã.
- `src/game/BowlingRenderer.ts`: sân, bóng, chai, ánh sáng, texture procedural và camera.
- `src/game/GameSession.ts` + `scoring.ts`: state machine, 10 frame, strike/spare/open và frame 10.
- `src/input/DesktopInput.ts`: bàn phím, chuột và cơ chế giữ/thả lấy lực.
- `src/controller/MotionController.ts`: xin quyền, hiệu chỉnh, low-pass filter, peak/impulse, cooldown.
- `src/network/WebRTCHost.ts` / `WebRTCController.ts`: PeerConnection, DataChannel và `getStats()`.
- `server/signaling.ts`: room, định tuyến SDP/ICE theo từng điện thoại, TTL + keepalive, thay socket cũ khi cùng tab nối lại, credential TURN tạm thời.
- `src/party/PartyRoom.ts`: ghế, màu, chủ phòng, ai được điều khiển ở lượt hiện tại.
- `src/marble`: sinh đường (`course.ts`), vật lý bi + khay (`physics.ts`), luật đua (`MarbleRace.ts`), bot, renderer canvas và hai trang TV/điện thoại.
- `src/ui`: HUD desktop, controller mobile, sảnh chờ dùng chung và bảng chẩn đoán.

## Luồng từ QR đến cú ném

1. Màn hình chính mở WebSocket tới signaling và tạo mã phòng ngẫu nhiên 10 ký tự (xấp xỉ 50 bit). Phòng sống khi tab còn mở (keepalive 5 phút/lần) và hết hạn sau 60 phút không hoạt động.
2. QR chứa URL trang controller, tên game và mã phòng. Điện thoại mở URL rồi join qua signaling; mỗi điện thoại được cấp một `peer` id.
3. Màn hình chính tạo một `RTCPeerConnection` riêng cho từng điện thoại, offer SDP và ICE candidates; signaling chỉ chuyển tiếp các bản tin này tới đúng peer.
4. ICE thử candidate trực tiếp với STUN. Nếu không được và có TURN, ICE chọn candidate `relay`.
5. Khi DTLS hoàn tất, hai DataChannel chạy trên SCTP:
   - `control`: reliable + ordered cho prepare/cancel/throw/ack/state.
   - `telemetry`: unordered + `maxRetransmits: 0`; bỏ sample cũ khi buffer tăng.
6. Điện thoại gửi lệnh ném có sequence ID. Laptop validate và clamp input, chặn ID trùng, chạy physics, chờ vật thể ổn định rồi mới tính điểm.

## Signaling, STUN và TURN khác nhau thế nào?

- **Signaling** là WebSocket do dự án tự chạy. Nó tạo/ghép phòng và chuyển offer, answer, ICE candidate. Nó không chở input gameplay sau khi DataChannel mở.
- **STUN** cho mỗi peer biết địa chỉ public/NAT mapping để ICE thử đường trực tiếp. STUN không relay dữ liệu.
- **TURN** relay gói tin khi NAT/firewall không cho đường trực tiếp. Bảng diagnostics báo `relay` từ candidate pair thực tế của `getStats()`; không suy đoán từ cấu hình.

DataChannel đưa message vào **SCTP** (đảm bảo thứ tự/retransmit tùy cấu hình), được mã hóa bởi **DTLS**, và đi qua candidate pair mà **ICE** chọn. Thông thường candidate pair dùng UDP. Nếu chỉ có TURN/TCP hoặc TURN/TLS, các gói DTLS/SCTP được relay qua TCP/TLS tới TURN — an toàn hơn về khả năng đi xuyên firewall nhưng thường có độ trễ và head-of-line blocking cao hơn.

RTT trong diagnostics là `currentRoundTripTime` của candidate pair. “Input → hình ảnh” là thời gian cục bộ từ lúc host nhận lệnh throw đến frame render kế tiếp; hai số này có ý nghĩa khác nhau và không phải số giả lập.

## HTTPS và cảm biến điện thoại

`DeviceMotion`/`DeviceOrientation` cần secure context trên điện thoại. `localhost` chỉ được ưu tiên đặc biệt trên chính máy đó, không áp dụng cho IP LAN. Cách dễ kiểm soát cho mạng nội bộ là tạo certificate tin cậy bằng [mkcert](https://github.com/FiloSottile/mkcert):

```bash
mkcert -install
mkcert 192.168.1.20 localhost 127.0.0.1
```

Sao chép `.env.example` thành `.env`, đặt đường dẫn `HTTPS_CERT`, `HTTPS_KEY`, `SIGNAL_TLS_CERT`, `SIGNAL_TLS_KEY`, và:

```dotenv
VITE_SIGNALING_URL=wss://192.168.1.20:8787
```

Khởi động lại `npm run dev`, mở `https://192.168.1.20:5173` trên laptop. Điện thoại phải tin CA của mkcert; không bỏ qua cảnh báo certificate. iOS chỉ hiển thị hộp xin quyền sau khi người dùng bấm **Bật cảm biến**. Nếu API/permission thiếu, controller vẫn chơi đầy đủ bằng cảm ứng và giải thích lý do.

## Cùng Wi-Fi và qua Internet

### Thử cùng Wi-Fi

1. Cho phép inbound TCP `5173`, TCP `8787` trong firewall của máy chạy host.
2. Dùng HTTPS/WSS như phần trên và truy cập bằng IP LAN của laptop.
3. STUN có thể chọn candidate `host` hoặc `srflx`. Nếu client isolation đang bật ở Wi-Fi, đường trực tiếp có thể thất bại.

### Thử qua Internet

1. Đặt web + signaling sau hostname/certificate công khai. Không dùng mixed content (`https` + `ws`).
2. Chạy Coturn trên máy có IP public. Mở UDP/TCP `3478`, TCP `5349` nếu dùng TURN/TLS, và dải relay (ví dụ `49160–49200` UDP/TCP).
3. Nếu Coturn sau NAT, đặt `external-ip=PUBLIC/PRIVATE` và forward đủ cổng.
4. Không nhúng TURN secret vào frontend. `server/signaling.ts` dùng `TURN_SECRET` để tạo username/credential HMAC-SHA1 hết hạn sau một giờ.

## TURN bằng Docker

1. Sao chép `infra/coturn/turnserver.conf`, thay `static-auth-secret`, `realm`, `external-ip` và certificate TLS nếu có.
2. Đặt cùng secret vào `.env` của signaling:

```dotenv
TURN_URLS=turn:203.0.113.10:3478?transport=udp,turn:203.0.113.10:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp
TURN_SECRET=mot-secret-ngau-nhien-dai
TURN_REALM=turn.example.com
```

3. Chạy `docker compose up -d coturn`.
4. Mở Network Lab trong game, bật **Ép TURN relay**. Chỉ khi route báo `TURN relay` và candidate là `relay` mới xem là đã qua TURN.

`network_mode: host` phù hợp Linux. Docker Desktop trên Windows/macOS cần map `3478`, `5349` và dải relay rõ ràng thay cho host mode. Không dùng TURN công khai không rõ nguồn gốc.

## Motion processing

Controller không cố suy ra vị trí bàn tay trong không gian. Nó dùng acceleration đã bỏ gravity khi trình duyệt cung cấp, low-pass filter, peak + tích phân cường độ để ước lượng lực; tốc độ quay và góc nghiêng đã hiệu chỉnh để ước lượng xoáy. Sample được giới hạn khoảng 30 Hz. Gesture cần vượt ngưỡng, có cửa sổ kết thúc và cooldown 1,4 giây để không phát hai cú ném. Input cuối cùng vẫn được clamp và xác thực lại ở laptop.

## Kiểm thử

`npm test` bao phủ:

- perfect game 300;
- toàn spare, toàn trượt;
- chuỗi strike/spare/open và frame 10;
- state gate, command ID trùng, giữ/reset rack;
- vector ném thay đổi theo lực/góc;
- sảnh party: màu/tên mặc định, chủ phòng, giới hạn 6 người, giữ ghế khi rớt mạng, chỉ người tới lượt điều khiển, không giả danh người khác;
- Marble: đường sinh theo seed luôn đi được, rơi hố/nhảy qua hố, va khối, nhặt ngọc, khay rơi bi khi nghiêng gắt quá lâu, luật về đích + ân hạn, bot về đích trên nhiều seed.

`npm run build` gồm `tsc --noEmit` và production build. QA trình duyệt cần kiểm tra thêm console, layout desktop/mobile và ném thực tế. Kiểm thử hai thiết bị thật, mạng khác nhau và TURN phụ thuộc certificate, firewall và hạ tầng thực tế của bạn; dự án không tuyên bố các trường hợp đó đã qua nếu chưa chạy trên các thiết bị đó.

## Giới hạn hiện tại

- Tối đa 6 người chơi mỗi ván (giới hạn bố cục bảng điểm/làn đua trên một màn hình).
- Danh tính chỉ theo tab: nếu trình duyệt điện thoại đóng hẳn tab rồi quét lại, người đó vào như người mới (ghế cũ hiện "mất kết nối"; màn hình chính vẫn ném hộ được trong Bowling).
- Physics được tinh chỉnh theo kiểu arcade; collider chai là capsule trong khi mesh có hình bowling chi tiết.
- Âm thanh được tổng hợp bằng Web Audio, chưa phải sample phòng bowling thu thật.
- Reconnect signaling giữ phòng khi controller rời, nhưng khi host đóng tab thì phòng bị hủy có chủ đích.
- Không có multiplayer giữa hai sân, tài khoản, lưu lịch sử hoặc backend điểm số.
- Coturn được cấu hình sẵn nhưng cần IP/certificate/firewall thực tế mới xác minh được relay Internet.
