# Pocket Arcade

Kho game party trên web: **Pocket Roll**, **Pocket Sumo**, **Pocket Bowling** và **Pocket Marble**. Cách chơi chung của cả kho:

1. Mở game trên TV hoặc laptop (màn hình chính).
2. Mọi người quét mã QR bằng điện thoại — không cài app, không cần tài khoản.
3. Cùng chơi trên một màn hình; mỗi điện thoại là một người chơi (Roll, Sumo, Marble tối đa 8, Bowling tối đa 6).

Điện thoại nối với màn hình chính qua **WebRTC DataChannel**. Màn hình chính là nguồn trạng thái duy nhất: vật lý, lượt chơi và điểm số đều được tính ở đó; điện thoại chỉ gửi input.

## Cấu trúc repo: mỗi game một site

```text
packages/party-kit/   phần dùng chung: phòng party, WebRTC, sảnh chờ, tay cầm, theme, CSS chung, server signaling
sites/pocket-arcade/  trang kho game (cổng 5173), chỉ đọc src/meta.ts của các game
sites/pocket-bowling/ Pocket Bowling (cổng 5174)
sites/pocket-marble/  Pocket Marble  (cổng 5175)
sites/pocket-sumo/    Pocket Sumo    (cổng 5176)
sites/pocket-roll/    Pocket Roll    (cổng 5177)
infra/, docker-compose.yml, .env.example   hạ tầng TURN và cấu hình dùng chung
```

Luật ranh giới (có test `tests/boundaries.test.ts` canh, vi phạm là `npm test` đỏ):

- Một site **không import site khác** và không với ra ngoài thư mục của nó; mọi thứ dùng chung đi qua `@pocket/party-kit`.
- Ngoại lệ duy nhất: kho game đọc `@pocket/<game>/meta` (tên, mô tả, số người chơi, cổng) để vẽ thẻ game.
- `party-kit` không biết tới game nào. Giao thức chung chỉ có `hello`/`lobby`/`ping`; lệnh riêng (ném, nhảy, húc…) do từng site khai báo và kiểm tra trong `src/protocol.ts`, truyền vào `new WebRTCHost(parseXxxCommand)`. Host gửi xuống `{ type: 'view' }` (trạng thái) và `{ type: 'event' }` (sự kiện tức thời như rung) với kiểu do game tự định nghĩa.
- Mỗi site có `index.html`, `vite.config.ts`, `src/main.ts` riêng: cùng một trang, thêm `?controller=1` là trang tay cầm trên điện thoại.

## Chạy nhanh

Yêu cầu: Node.js 20+ và npm. Mọi lệnh chạy ở gốc repo (npm workspaces).

```bash
npm install
npm run dev            # signaling + kho game + cả 4 game
npm run dev:sumo       # chỉ signaling + một game (dev:arcade, dev:bowling, dev:marble, dev:roll)
npm test               # test của party-kit, mọi site và luật ranh giới
npm run build          # typecheck + build từng site vào sites/*/dist
```

| Site | Dev | Ghi chú |
| --- | --- | --- |
| Kho game | `http://localhost:5173` | link sang các game theo cổng bên dưới |
| Bowling | `http://localhost:5174` | |
| Marble | `http://localhost:5175` | |
| Sumo | `http://localhost:5176` | |
| Roll | `http://localhost:5177` | |
| Signaling | `ws://localhost:8787` | một server dùng chung cho mọi game |

Khi deploy mỗi site lên tên miền/đường dẫn riêng, đặt trong `.env` ở gốc: `VITE_ARCADE_URL` (link "Về kho game" của mọi game) và `VITE_SITE_<ID>_URL` (ví dụ `VITE_SITE_SUMO_URL`) để kho game trỏ đúng.

### Thêm game mới

1. Tạo `sites/pocket-<id>/` theo mẫu một site có sẵn: `package.json` (tên `@pocket/<id>`, export `./meta`), `tsconfig.json`, `vite.config.ts` (cổng riêng), `index.html`, `src/main.ts`, `src/styles.css`.
2. Khai báo `src/meta.ts` (kể cả `players`) và `src/protocol.ts` (lệnh riêng + parser).
3. Thêm một dòng vào `sites/pocket-arcade/src/catalog.ts` và một script `dev:<id>` ở `package.json` gốc.

## Số người chơi theo từng game

Mỗi game tự đặt giới hạn trong trường `players` của `src/meta.ts` trong site của nó:

| Game | Party (mỗi điện thoại một người) | Chơi trên máy này |
| --- | --- | --- |
| Pocket Roll | 1–8 | 1 hoặc 2 người chung bàn phím |
| Pocket Sumo | 1–8 | 1, 2 hoặc 3 người chung bàn phím |
| Pocket Marble | 1–8 | 1, 2 hoặc 3 người chung bàn phím |
| Pocket Bowling | 1–6 | 1 hoặc 2 người |

- `max` quyết định số ghế trong sảnh (`PartyRoom`), số hiển thị `0/N` trên TV/điện thoại và thẻ "1–N người" ở kho game.
- `local` là các nút ở mục "Chơi trên máy này". Bàn phím chung: P1 mũi tên, P2 `WASD`, P3 `IJKL` (Marble: `J`/`L` lái, `I` nhảy; Sumo: `O` húc).
- Trần chung là `MAX_PLAYERS = 8` trong `packages/party-kit/src/players.ts`, bằng số màu người chơi; muốn cho game nào đông hơn thì thêm màu và nâng trần, đồng thời nâng `MAX_CONTROLLERS` của signaling.
- Bowling chơi theo lượt (mỗi người 10 frame) nên giữ ít người hơn để không phải chờ lâu.

## Chế độ party (mọi game)

- Màn hình chính mở sảnh chờ ngay khi vào game: QR lớn, mã phòng, danh sách người chơi. Mỗi điện thoại quét QR là xuất hiện ngay với một màu riêng; tên là tùy chọn (để trống thì là "Người chơi N"), lưu trên máy.
- Người vào đầu tiên là **chủ phòng**: bấm bắt đầu/chơi lại ngay trên điện thoại, không cần chạm vào TV. TV vẫn có nút bắt đầu riêng.
- Danh tính theo từng tab (`sessionStorage`): tải lại trang hoặc mở khóa màn hình thì tự vào lại đúng ghế; mở tab khác là một người chơi khác (tiện thử nhiều "điện thoại" trên một máy).
- Mất kết nối giữa ván thì ghế được giữ và TV ghi "mất kết nối"; người vào giữa ván sẽ chơi từ ván sau.
- Signaling cho tối đa `MAX_CONTROLLERS` (mặc định 10) điện thoại mỗi phòng: 8 người chơi của game đông nhất + chỗ cho máy xem/kết nối lại.

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

Các module dùng chung (`packages/party-kit`):

- `src/network/protocol.ts`: lệnh chung, kiểu tin host → điện thoại, các hàm kiểm tra giá trị dùng cho parser của từng game.
- `src/network/WebRTCHost.ts` / `WebRTCController.ts`: PeerConnection, DataChannel và `getStats()`.
- `server/signaling.ts`: room, định tuyến SDP/ICE theo từng điện thoại, TTL + keepalive, thay socket cũ khi cùng tab nối lại, credential TURN tạm thời.
- `src/party/PartyRoom.ts`: ghế, màu, chủ phòng, ai được điều khiển ở lượt hiện tại.
- `src/ui/HostLobby.ts`, `PhoneConnection.ts`, `PhoneSeat.ts`: sảnh chờ trên TV, kết nối + thẻ "bạn là ai" trên điện thoại.
- `src/controller/TiltController.ts`: đọc độ nghiêng điện thoại (Marble, Roll).
- `src/styles/party.css`: giao diện chung (sảnh, tay cầm, banner, thẻ người chơi, sảnh thu gọn bên trái…).

Module riêng của từng game: xem README trong `sites/<game>/`.

## Luồng từ QR đến cú ném

1. Màn hình chính mở WebSocket tới signaling và tạo mã phòng ngẫu nhiên 10 ký tự (xấp xỉ 50 bit). Phòng sống khi tab còn mở (keepalive 5 phút/lần) và hết hạn sau 60 phút không hoạt động.
2. QR chứa URL trang controller của chính site đó (`?controller=1`) và mã phòng. Điện thoại mở URL rồi join qua signaling; mỗi điện thoại được cấp một `peer` id.
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

Sao chép `.env.example` (ở gốc repo, dùng chung cho mọi site) thành `.env`, đặt đường dẫn `HTTPS_CERT`, `HTTPS_KEY`, `SIGNAL_TLS_CERT`, `SIGNAL_TLS_KEY`, và:

```dotenv
VITE_SIGNALING_URL=wss://192.168.1.20:8787
```

Khởi động lại `npm run dev`, mở `https://192.168.1.20:5173` (kho game) hoặc cổng của từng game trên laptop. Điện thoại phải tin CA của mkcert; không bỏ qua cảnh báo certificate. iOS chỉ hiển thị hộp xin quyền sau khi người dùng bấm **Bật cảm biến**. Nếu API/permission thiếu, controller vẫn chơi đầy đủ bằng cảm ứng và giải thích lý do.

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

## Kiểm thử

`npm test` chạy mọi test trong `tests/` (luật ranh giới giữa các site), `packages/party-kit/tests/` (sảnh party, giao thức chung) và `sites/*/tests/` (luật chơi của từng game, xem README của site). Có thể chạy riêng: `npx vitest run sites/pocket-roll`.

`npm run build` gồm `tsc --noEmit` và production build của từng site. QA trình duyệt cần kiểm tra thêm console, layout desktop/mobile và thao tác thật trên điện thoại. Kiểm thử hai thiết bị thật, mạng khác nhau và TURN phụ thuộc certificate, firewall và hạ tầng thực tế của bạn; dự án không tuyên bố các trường hợp đó đã qua nếu chưa chạy trên các thiết bị đó.

## Giới hạn hiện tại

- Tối đa 8 người chơi mỗi ván (Bowling 6) — giới hạn bởi số màu dễ phân biệt và bố cục bảng điểm/làn đua trên một màn hình.
- Danh tính chỉ theo tab: nếu trình duyệt điện thoại đóng hẳn tab rồi quét lại, người đó vào như người mới (ghế cũ hiện "mất kết nối"; màn hình chính vẫn ném hộ được trong Bowling).
- Physics được tinh chỉnh theo kiểu arcade; collider chai là capsule trong khi mesh có hình bowling chi tiết.
- Âm thanh được tổng hợp bằng Web Audio, chưa phải sample phòng bowling thu thật.
- Reconnect signaling giữ phòng khi controller rời, nhưng khi host đóng tab thì phòng bị hủy có chủ đích.
- Không có multiplayer giữa hai sân, tài khoản, lưu lịch sử hoặc backend điểm số.
- Coturn được cấu hình sẵn nhưng cần IP/certificate/firewall thực tế mới xác minh được relay Internet.
