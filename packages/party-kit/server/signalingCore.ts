import crypto from 'node:crypto';
import type http from 'node:http';
import type https from 'node:https';
import { WebSocket, WebSocketServer } from 'ws';

type ClientRole = 'host' | 'controller' | null;
interface PeerSocket extends WebSocket { role: ClientRole; room: string; peer: string; clientId: string; alive: boolean }
interface Room { host: PeerSocket; controllers: Map<string, PeerSocket>; expiresAt: number }

const roomTtl = Math.max(60_000, Number(process.env.ROOM_TTL_MS || 3_600_000));
// Game đông nhất cho 8 người chơi + chỗ cho vài máy xem/kết nối lại trong lúc socket cũ chưa bị dọn.
const maxControllers = Math.max(1, Math.min(16, Number(process.env.MAX_CONTROLLERS || 10)));
const rooms = new Map<string, Room>();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function createRoomCode(): string {
  for (;;) {
    const bytes = crypto.randomBytes(10);
    let code = '';
    for (let index = 0; index < 10; index += 1) code += alphabet[bytes[index]! % alphabet.length];
    if (!rooms.has(code)) return code;
  }
}

function temporaryIceServers(): RTCIceServer[] {
  const stunUrls = (process.env.STUN_URLS || 'stun:stun.cloudflare.com:3478').split(',').map((value) => value.trim()).filter(Boolean);
  const servers: RTCIceServer[] = stunUrls.length ? [{ urls: stunUrls }] : [];
  const turnUrls = (process.env.TURN_URLS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const secret = process.env.TURN_SECRET;
  if (turnUrls.length && secret) {
    const username = `${Math.floor(Date.now() / 1000) + 3_600}:${crypto.randomBytes(8).toString('hex')}`;
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
    servers.push({ urls: turnUrls, username, credential });
  }
  return servers;
}

function send(socket: WebSocket | null, value: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function safeRoom(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 10) : '';
}

function safeClientId(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : crypto.randomBytes(12).toString('hex');
}

export interface SignalingOptions {
  /** Chỉ nhận WebSocket ở đường dẫn này (server production dùng '/ws'); bỏ trống thì nhận mọi đường dẫn. */
  path?: string;
}

export interface Signaling {
  readonly roomCount: number;
  readonly maxControllers: number;
  readonly roomTtlMs: number;
  close(callback?: () => void): void;
}

/**
 * Gắn server ghép phòng (WebSocket) vào một HTTP server có sẵn: server dev riêng ở cổng 8787
 * hoặc server production phục vụ cả trang web lẫn signaling trên một cổng.
 */
export function attachSignaling(server: http.Server | https.Server, options: SignalingOptions = {}): Signaling {
  const wss = new WebSocketServer({ server, path: options.path, maxPayload: 100_000 });

  wss.on('connection', (rawSocket) => {
    const socket = rawSocket as PeerSocket;
    socket.role = null;
    socket.room = '';
    socket.peer = '';
    socket.clientId = '';
    socket.alive = true;
    socket.on('pong', () => { socket.alive = true; });

    socket.on('message', (buffer, binary) => {
      const byteLength = Array.isArray(buffer)
        ? buffer.reduce((total, chunk) => total + chunk.byteLength, 0)
        : buffer.byteLength;
      if (binary || byteLength > 100_000) return socket.close(1009, 'Tin nhắn quá lớn');
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(buffer.toString()) as Record<string, unknown>;
      } catch {
        return send(socket, { type: 'error', message: 'JSON không hợp lệ' });
      }

      if (message.type === 'host:create' && socket.role === null) {
        const room = createRoomCode();
        socket.role = 'host';
        socket.room = room;
        rooms.set(room, { host: socket, controllers: new Map(), expiresAt: Date.now() + roomTtl });
        send(socket, { type: 'room:created', room, iceServers: temporaryIceServers(), expiresInMs: roomTtl });
        return;
      }

      if (message.type === 'controller:join' && socket.role === null) {
        const code = safeRoom(message.room);
        const room = rooms.get(code);
        if (!room || room.expiresAt < Date.now()) return send(socket, { type: 'error', message: 'Phòng không tồn tại hoặc đã hết hạn' });
        const clientId = safeClientId(message.clientId);
        // Cùng một tab nối lại (tải lại trang, mạng chập chờn): thay socket cũ để không chiếm chỗ.
        room.controllers.forEach((existing) => {
          if (existing.clientId !== clientId) return;
          room.controllers.delete(existing.peer);
          existing.room = '';
          send(room.host, { type: 'controller:left', peer: existing.peer });
          existing.close(4001, 'Replaced');
        });
        if (room.controllers.size >= maxControllers) return send(socket, { type: 'error', message: 'Phòng đã đủ người' });
        socket.role = 'controller';
        socket.room = code;
        socket.peer = crypto.randomBytes(6).toString('hex');
        socket.clientId = clientId;
        room.controllers.set(socket.peer, socket);
        room.expiresAt = Date.now() + roomTtl;
        send(socket, { type: 'room:joined', room: code, peer: socket.peer, iceServers: temporaryIceServers() });
        send(room.host, { type: 'controller:joined', peer: socket.peer });
        return;
      }

      if (message.type === 'host:ready' && socket.role === 'host') {
        rooms.get(socket.room)?.controllers.forEach((controller) => send(socket, { type: 'controller:joined', peer: controller.peer }));
        return;
      }

      if (message.type === 'host:keepalive' && socket.role === 'host') {
        const room = rooms.get(socket.room);
        if (room) room.expiresAt = Date.now() + roomTtl;
        return;
      }

      if (message.type === 'signal' && socket.room) {
        const room = rooms.get(socket.room);
        if (!room || message.room !== socket.room || !message.data || typeof message.data !== 'object') return;
        room.expiresAt = Date.now() + roomTtl;
        const encoded = JSON.stringify(message.data);
        if (encoded.length > 90_000) return;
        if (socket.role === 'host') {
          send(room.controllers.get(String(message.to)) ?? null, { type: 'signal', data: message.data });
        } else {
          send(room.host, { type: 'signal', from: socket.peer, data: message.data });
        }
      }
    });

    socket.on('close', () => {
      if (!socket.room) return;
      const room = rooms.get(socket.room);
      if (!room) return;
      if (socket.role === 'host') {
        room.controllers.forEach((controller) => {
          send(controller, { type: 'error', message: 'Màn hình chính đã đóng phòng' });
          controller.close(1000, 'Host left');
        });
        rooms.delete(socket.room);
      } else if (room.controllers.get(socket.peer) === socket) {
        room.controllers.delete(socket.peer);
        send(room.host, { type: 'controller:left', peer: socket.peer });
      }
    });
  });

  const maintenance = setInterval(() => {
    const now = Date.now();
    rooms.forEach((room, code) => {
      if (room.expiresAt < now) {
        send(room.host, { type: 'error', message: 'Phòng đã hết hạn' });
        room.host.close(1000, 'Room expired');
        room.controllers.forEach((controller) => controller.close(1000, 'Room expired'));
        rooms.delete(code);
      }
    });
    wss.clients.forEach((rawSocket) => {
      const socket = rawSocket as PeerSocket;
      if (!socket.alive) return socket.terminate();
      socket.alive = false;
      socket.ping();
    });
  }, 30_000);

  return {
    get roomCount() { return rooms.size; },
    maxControllers,
    roomTtlMs: roomTtl,
    close(callback) {
      clearInterval(maintenance);
      wss.close(() => callback?.());
    },
  };
}
