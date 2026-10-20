import type { NetworkStats } from '../types';
import { parseControllerCommand, serialize, type ControllerCommand, type HostCommand } from './protocol';
import { SignalingClient, type SignalMessage } from './SignalingClient';

const INITIAL_STATS: NetworkStats = {
  signaling: 'chưa kết nối', ice: 'new', control: 'closed', telemetry: 'closed', route: 'unknown',
  localCandidate: '—', remoteCandidate: '—', rttMs: null, inputToVisualMs: null,
  bytesSent: 0, bytesReceived: 0, error: '', forceRelay: false, controllers: 0,
};

const KEEPALIVE_MS = 5 * 60_000;

export interface CommandResult {
  accepted: boolean;
  reason?: string;
}

/** Một điện thoại: PeerConnection riêng với hai DataChannel riêng. */
interface HostPeer {
  id: string;
  connection: RTCPeerConnection;
  control: RTCDataChannel;
  telemetry: RTCDataChannel;
  pendingCandidates: RTCIceCandidateInit[];
  open: boolean;
}

export class WebRTCHost {
  room = '';
  iceServers: RTCIceServer[] = [];
  stats: NetworkStats = { ...INITIAL_STATS };
  onRoom?: (room: string) => void;
  onStats?: (stats: NetworkStats) => void;
  onPeerOpen?: (peer: string) => void;
  onPeerClose?: (peer: string) => void;
  /** Lệnh đã validate. Với lệnh có `seq`, kết quả trả về được gửi lại thành ack. */
  onCommand?: (peer: string, command: ControllerCommand, receivedAt: number) => CommandResult | void;
  onTelemetry?: (peer: string, sample: Record<string, unknown>) => void;
  private readonly signaling = new SignalingClient();
  private readonly peers = new Map<string, HostPeer>();
  private statsFocus = '';
  private statsTimer = 0;
  private keepaliveTimer = 0;

  constructor() {
    this.signaling.onState = (state, error) => {
      this.patchStats({ signaling: state, error: error ?? this.stats.error });
    };
    this.signaling.onMessage((message) => void this.handleSignal(message));
  }

  async start(): Promise<string> {
    await this.signaling.connect();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Không tạo được phòng')), 6_000);
      const off = this.signaling.onMessage((message) => {
        if (message.type === 'room:created' && typeof message.room === 'string') {
          window.clearTimeout(timeout);
          off();
          this.room = message.room;
          this.iceServers = Array.isArray(message.iceServers) ? message.iceServers as RTCIceServer[] : [];
          this.statsTimer = window.setInterval(() => void this.collectStats(), 2_000);
          // TV có thể mở sảnh chờ hàng giờ; giữ phòng sống khi tab host vẫn hoạt động.
          this.keepaliveTimer = window.setInterval(() => this.signaling.send({ type: 'host:keepalive' }), KEEPALIVE_MS);
          this.onRoom?.(this.room);
          resolve(this.room);
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          off();
          reject(new Error(String(message.message ?? 'Lỗi signaling')));
        }
      });
      this.signaling.send({ type: 'host:create' });
    });
  }

  /** Các điện thoại đã mở kênh lệnh. */
  get openPeers(): string[] {
    return [...this.peers.values()].filter((peer) => peer.open).map((peer) => peer.id);
  }

  setForceRelay(enabled: boolean): void {
    this.patchStats({ forceRelay: enabled });
    // Peer id do signaling cấp nên vẫn giữ nguyên; tạo lại kết nối mà không coi là rời phòng.
    [...this.peers.keys()].forEach((id) => void this.createPeer(id));
  }

  /** Bảng chẩn đoán hiển thị số liệu của điện thoại này (thường là người đang tới lượt). */
  setStatsFocus(peer: string): void {
    if (peer === this.statsFocus || !this.peers.has(peer)) return;
    this.statsFocus = peer;
    void this.collectStats();
  }

  send(peer: string, message: HostCommand): void {
    const control = this.peers.get(peer)?.control;
    if (control?.readyState === 'open' && control.bufferedAmount < 256_000) control.send(serialize(message));
  }

  setInputToVisualLatency(ms: number): void {
    this.patchStats({ inputToVisualMs: ms });
  }

  dispose(): void {
    window.clearInterval(this.statsTimer);
    window.clearInterval(this.keepaliveTimer);
    [...this.peers.keys()].forEach((id) => this.closePeer(id, false));
    this.signaling.close();
  }

  private async createPeer(id: string): Promise<void> {
    this.closePeer(id, false);
    const connection = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.stats.forceRelay ? 'relay' : 'all',
      bundlePolicy: 'max-bundle',
    });
    const peer: HostPeer = {
      id,
      connection,
      control: connection.createDataChannel('control', { ordered: true }),
      telemetry: connection.createDataChannel('telemetry', { ordered: false, maxRetransmits: 0 }),
      pendingCandidates: [],
      open: false,
    };
    this.peers.set(id, peer);
    this.bindChannels(peer);
    connection.onicecandidate = (event) => {
      if (event.candidate) this.signaling.send({ type: 'signal', room: this.room, to: id, data: { candidate: event.candidate.toJSON() } });
    };
    connection.oniceconnectionstatechange = () => {
      if (this.isFocused(peer)) this.patchStats({ ice: connection.iceConnectionState });
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed') this.patchStats({ error: 'WebRTC thất bại; kiểm tra STUN/TURN và firewall.' });
    };
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    this.signaling.send({ type: 'signal', room: this.room, to: id, data: { description: connection.localDescription } });
  }

  private bindChannels(peer: HostPeer): void {
    const { control, telemetry, id } = peer;
    // Kênh của kết nối đã bị thay thế vẫn có thể bắn sự kiện muộn; bỏ qua chúng.
    const current = () => this.peers.get(id) === peer;
    control.onopen = () => {
      if (!current()) return;
      peer.open = true;
      if (!this.statsFocus || !this.peers.get(this.statsFocus)?.open) this.statsFocus = id;
      this.refreshChannelStats();
      this.onPeerOpen?.(id);
    };
    control.onclose = () => {
      if (current()) this.closePeer(id, true);
    };
    control.onerror = () => this.patchStats({ error: 'Kênh lệnh WebRTC gặp lỗi.' });
    control.onmessage = (event) => {
      if (!current() || typeof event.data !== 'string') return;
      const command = parseControllerCommand(event.data);
      if (!command) {
        this.patchStats({ error: 'Đã chặn input điều khiển không hợp lệ.' });
        return;
      }
      if (command.type === 'ping') {
        this.send(id, { type: 'pong', id: command.id, sentAt: command.sentAt });
        return;
      }
      const result = this.onCommand?.(id, command, performance.now());
      if ('seq' in command) {
        this.send(id, { type: 'ack', seq: command.seq, accepted: result?.accepted ?? false, reason: result?.reason });
      }
    };
    telemetry.onopen = () => this.refreshChannelStats();
    telemetry.onclose = () => this.refreshChannelStats();
    telemetry.onmessage = (event) => {
      if (!current() || typeof event.data !== 'string' || event.data.length > 1_024) return;
      try {
        const sample = JSON.parse(event.data) as Record<string, unknown>;
        if (sample.type === 'motion' && typeof sample.seq === 'number') this.onTelemetry?.(id, sample);
      } catch {
        // Telemetry is intentionally disposable.
      }
    };
  }

  private async handleSignal(message: SignalMessage): Promise<void> {
    if (message.type === 'controller:joined' && typeof message.peer === 'string') {
      await this.createPeer(message.peer);
      return;
    }
    if (message.type === 'controller:left' && typeof message.peer === 'string') {
      this.closePeer(message.peer, true);
      return;
    }
    if (message.type !== 'signal' || typeof message.from !== 'string' || !message.data || typeof message.data !== 'object') return;
    const peer = this.peers.get(message.from);
    if (!peer) return;
    const { connection } = peer;
    const data = message.data as { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    if (data.description) {
      await connection.setRemoteDescription(data.description);
      for (const candidate of peer.pendingCandidates.splice(0)) await connection.addIceCandidate(candidate);
    } else if (data.candidate) {
      if (connection.remoteDescription) await connection.addIceCandidate(data.candidate);
      else peer.pendingCandidates.push(data.candidate);
    }
  }

  private async collectStats(): Promise<void> {
    const peer = this.peers.get(this.statsFocus);
    if (!peer) return;
    const report = await peer.connection.getStats();
    let pair: Record<string, any> | undefined;
    report.forEach((stat) => {
      if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && (stat.nominated || !pair)) pair = stat;
    });
    if (!pair || !this.isFocused(peer)) return;
    const local = report.get(pair.localCandidateId) as Record<string, any> | undefined;
    const remote = report.get(pair.remoteCandidateId) as Record<string, any> | undefined;
    const route = local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : 'direct';
    this.patchStats({
      ice: peer.connection.iceConnectionState,
      route,
      localCandidate: String(local?.candidateType ?? 'unknown'),
      remoteCandidate: String(remote?.candidateType ?? 'unknown'),
      rttMs: typeof pair.currentRoundTripTime === 'number' ? pair.currentRoundTripTime * 1000 : null,
      bytesSent: Number(pair.bytesSent ?? 0),
      bytesReceived: Number(pair.bytesReceived ?? 0),
    });
  }

  private closePeer(id: string, notify: boolean): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.control.close();
    peer.telemetry.close();
    peer.connection.close();
    if (this.statsFocus === id) {
      this.statsFocus = this.openPeers[0] ?? '';
      this.patchStats({ route: 'unknown', localCandidate: '—', remoteCandidate: '—', rttMs: null });
    }
    this.refreshChannelStats();
    if (notify && peer.open) this.onPeerClose?.(id);
  }

  private isFocused(peer: HostPeer): boolean {
    return this.statsFocus === peer.id && this.peers.get(peer.id) === peer;
  }

  private refreshChannelStats(): void {
    const focus = this.peers.get(this.statsFocus);
    this.patchStats({
      control: focus?.control.readyState ?? 'closed',
      telemetry: focus?.telemetry.readyState ?? 'closed',
      controllers: this.openPeers.length,
    });
  }

  private patchStats(patch: Partial<NetworkStats>): void {
    this.stats = { ...this.stats, ...patch };
    this.onStats?.({ ...this.stats });
  }
}
