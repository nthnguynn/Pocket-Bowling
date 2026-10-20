export type SignalMessage = Record<string, unknown> & { type: string };

export function defaultSignalingUrl(): string {
  const configured = import.meta.env.VITE_SIGNALING_URL as string | undefined;
  if (configured) return configured;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.hostname}:8787`;
}

export class SignalingClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<(message: SignalMessage) => void>();
  onState?: (state: string, error?: string) => void;

  constructor(readonly url = defaultSignalingUrl()) {}

  connect(): Promise<void> {
    this.close();
    this.onState?.('đang kết nối');
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const timer = window.setTimeout(() => {
        reject(new Error('Signaling không phản hồi'));
        socket.close();
      }, 6_000);
      socket.addEventListener('open', () => {
        window.clearTimeout(timer);
        this.onState?.('đã kết nối');
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        window.clearTimeout(timer);
        this.onState?.('lỗi', `Không mở được ${this.url}`);
        reject(new Error(`Không mở được signaling ${this.url}`));
      }, { once: true });
      socket.addEventListener('close', () => {
        // Socket cũ đóng sau khi đã nối lại thì không còn là trạng thái hiện tại.
        if (this.socket === socket) this.onState?.('đã ngắt');
      });
      socket.addEventListener('message', (event) => {
        if (typeof event.data !== 'string' || event.data.length > 100_000) return;
        try {
          const message = JSON.parse(event.data) as SignalMessage;
          if (message && typeof message.type === 'string') this.listeners.forEach((listener) => listener(message));
        } catch {
          this.onState?.('lỗi', 'Signaling gửi JSON không hợp lệ');
        }
      });
    });
  }

  onMessage(listener: (message: SignalMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(message: unknown): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
    this.socket = null;
  }
}
