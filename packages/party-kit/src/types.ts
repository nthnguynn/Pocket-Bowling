export interface PlayerSetup {
  name: string;
  color: string;
}

/** Số người chơi của một game: mỗi game tự đặt, không vượt MAX_PLAYERS (số màu người chơi có sẵn). */
export interface PlayerLimits {
  /** Số điện thoại tối đa vào một ván party (mỗi máy một người). */
  max: number;
  /** Các lựa chọn "Chơi trên máy này" (chung bàn phím/chuột) ở sảnh chờ. */
  local: number[];
}

export interface NetworkStats {
  signaling: string;
  ice: string;
  control: string;
  telemetry: string;
  route: 'direct' | 'relay' | 'unknown';
  localCandidate: string;
  remoteCandidate: string;
  rttMs: number | null;
  inputToVisualMs: number | null;
  bytesSent: number;
  bytesReceived: number;
  error: string;
  forceRelay: boolean;
  controllers: number;
}

/** lobby: TV đang ở sảnh chờ · local: chơi trên máy host, điện thoại là tay cầm chung · party: mỗi điện thoại là một người chơi. */
export type PartyStage = 'lobby' | 'local' | 'party';

export interface PartyMember {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  player: number | null;
}

export interface PartyState {
  stage: PartyStage;
  members: PartyMember[];
  maxPlayers: number;
  leader: string | null;
}

export interface Seat {
  member: string | null;
  player: number | null;
  leader: boolean;
  control: boolean;
}

/** Thông tin một game mà trang kho game hiển thị; mỗi site tự khai báo trong src/meta.ts. */
export interface SiteMeta {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  /** Không ghi số người ở đây: thẻ "1–N người" được sinh từ `players`. */
  tags: string[];
  players: PlayerLimits;
  /** Cổng chạy khi dev (khớp vite.config.ts của site); khi deploy thì đặt VITE_SITE_<ID>_URL. */
  devPort: number;
}
