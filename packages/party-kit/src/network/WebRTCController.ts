import type { RaceView } from '../marble/MarbleRace';
import type { GameSnapshot, PartyState, Seat } from '../types';
import { serialize, type ControllerCommand, type HostCommand, type ThrowCommand } from './protocol';
import { SignalingClient, type SignalMessage } from './SignalingClient';

export class WebRTCController {
  onState?: (state: string, detail?: string) => void;
  onGameState?: (snapshot: GameSnapshot, party: PartyState, seat: Seat) => void;
  onRace?: (view: RaceView | null, party: PartyState, seat: Seat) => void;
  onAck?: (seq: string, accepted: boolean, reason?: string) => void;
  onNotice?: (message: string) => void;
  /** Kênh lệnh vừa mở: lúc gửi hello để host gán ghế. */
  onOpen?: () => void;
  private readonly signaling = new SignalingClient();
  private peer: RTCPeerConnection | null = null;
  private control: RTCDataChannel | null = null;
  private telemetry: RTCDataChannel | null = null;
  private iceServers: RTCIceServer[] = [];
  private room = '';
  private clientId = '';
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private telemetrySeq = 0;

  constructor() {
    this.signaling.onState = (state, error) => this.onState?.(state, error);
    this.signaling.onMessage((message) => void this.handleSignal(message));
  }

  get isOpen(): boolean {
    return this.control?.readyState === 'open';
  }

  async connect(room: string, clientId: string): Promise<void> {
    this.room = room.trim().toUpperCase().replace(/[^A-Z2-9]/g, '');
    this.clientId = clientId;
    await this.signaling.connect();
    this.onState?.('đang ghép phòng');
    this.signaling.send({ type: 'controller:join', room: this.room, clientId: this.clientId });
  }

  sendCommand(command: ControllerCommand): boolean {
    if (this.control?.readyState !== 'open' || this.control.bufferedAmount > 128_000) return false;
    this.control.send(serialize(command));
    return true;
  }

  sendThrow(command: Omit<ThrowCommand, 'type'>): boolean {
    return this.sendCommand({ ...command, type: 'throw' });
  }

  sendMotion(sample: Record<string, number>): boolean {
    if (this.telemetry?.readyState !== 'open' || this.telemetry.bufferedAmount > 48_000) return false;
    this.telemetry.send(JSON.stringify({ type: 'motion', seq: this.telemetrySeq++, ...sample }));
    return true;
  }

  dispose(): void {
    this.closePeer();
    this.signaling.close();
  }

  private async handleSignal(message: SignalMessage): Promise<void> {
    if (message.type === 'room:joined') {
      this.iceServers = Array.isArray(message.iceServers) ? message.iceServers as RTCIceServer[] : [];
      this.onState?.('đang thương lượng WebRTC');
      return;
    }
    if (message.type === 'error') {
      this.onState?.('lỗi', String(message.message ?? 'Không thể ghép phòng'));
      return;
    }
    if (message.type !== 'signal' || !message.data || typeof message.data !== 'object') return;
    const data = message.data as { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    if (data.description?.type === 'offer') {
      await this.acceptOffer(data.description);
    } else if (data.candidate) {
      if (this.peer?.remoteDescription) await this.peer.addIceCandidate(data.candidate);
      else this.pendingCandidates.push(data.candidate);
    }
  }

  private async acceptOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    this.closePeer();
    const peer = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
    this.peer = peer;
    peer.onicecandidate = (event) => {
      if (event.candidate) this.signaling.send({ type: 'signal', room: this.room, data: { candidate: event.candidate.toJSON() } });
    };
    peer.onconnectionstatechange = () => {
      if (this.peer === peer) this.onState?.(`WebRTC: ${peer.connectionState}`);
    };
    peer.ondatachannel = (event) => {
      if (this.peer !== peer) return;
      if (event.channel.label === 'control') this.bindControl(event.channel);
      if (event.channel.label === 'telemetry') this.telemetry = event.channel;
    };
    await peer.setRemoteDescription(offer);
    for (const candidate of this.pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    this.signaling.send({ type: 'signal', room: this.room, data: { description: peer.localDescription } });
  }

  private bindControl(channel: RTCDataChannel): void {
    this.control = channel;
    channel.onopen = () => {
      if (this.control !== channel) return;
      this.onState?.('đã kết nối', 'DataChannel reliable/ordered đã sẵn sàng');
      this.onOpen?.();
    };
    channel.onclose = () => {
      if (this.control === channel) this.onState?.('mất kết nối', 'Đang chờ màn hình chính nối lại…');
    };
    channel.onmessage = (event) => {
      if (this.control !== channel || typeof event.data !== 'string' || event.data.length > 100_000) return;
      try {
        const message = JSON.parse(event.data) as HostCommand;
        if (message.type === 'state' && message.snapshot && message.party && message.seat) {
          this.onGameState?.(message.snapshot, message.party, message.seat);
        }
        if (message.type === 'race' && message.party && message.seat) this.onRace?.(message.view ?? null, message.party, message.seat);
        if (message.type === 'ack') this.onAck?.(message.seq, message.accepted, message.reason);
        if (message.type === 'notice' && typeof message.message === 'string') this.onNotice?.(message.message);
      } catch {
        this.onState?.('lỗi', 'Phản hồi từ màn hình chính không hợp lệ');
      }
    };
  }

  private closePeer(): void {
    // Bỏ tham chiếu trước khi đóng để sự kiện close muộn của kênh cũ không báo nhầm.
    const { peer, control, telemetry } = this;
    this.peer = null;
    this.control = null;
    this.telemetry = null;
    control?.close();
    telemetry?.close();
    peer?.close();
    this.pendingCandidates = [];
  }
}
