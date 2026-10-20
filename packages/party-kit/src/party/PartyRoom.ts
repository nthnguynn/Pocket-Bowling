import { MAX_PLAYERS, PLAYER_COLORS } from '../game/players';
import type { PartyStage, PartyState, PlayerSetup, Seat } from '../types';

interface Member {
  id: string;
  /** Bí mật của từng tab điện thoại, chỉ host biết; dùng để nhận lại ghế khi tải lại trang. */
  clientId: string;
  name: string;
  color: string;
  peer: string | null;
}

export type JoinResult =
  | { member: Member; rejoined: boolean }
  | { member: null; reason: string };

/**
 * Danh sách điện thoại trong phòng ở phía host. Điện thoại chỉ là nguồn input:
 * host quyết định ai giữ ghế nào, ai là chủ phòng và ai được ném ở lượt hiện tại.
 */
export class PartyRoom {
  stage: PartyStage = 'lobby';
  private members: Member[] = [];
  private lineup: string[] = [];
  private nextId = 1;

  constructor(readonly maxPlayers = MAX_PLAYERS) {}

  join(peer: string, clientId: string, name: string): JoinResult {
    const current = this.memberByPeer(peer);
    if (current) {
      // Một kết nối không được đổi danh tính giữa chừng; hello lặp lại chỉ để đổi tên.
      this.applyName(current, name);
      return { member: current, rejoined: true };
    }
    const existing = this.members.find((member) => member.clientId === clientId);
    if (existing) {
      existing.peer = peer;
      this.applyName(existing, name);
      return { member: existing, rejoined: true };
    }
    if (this.members.length >= this.maxPlayers) {
      return { member: null, reason: `Phòng đã đủ ${this.maxPlayers} người chơi — bạn đang xem` };
    }
    const color = PLAYER_COLORS.find((candidate) => !this.members.some((member) => member.color === candidate))
      ?? PLAYER_COLORS[this.members.length % PLAYER_COLORS.length]!;
    const member: Member = { id: `m${this.nextId++}`, clientId, name: '', color, peer };
    this.members.push(member);
    this.applyName(member, name);
    return { member, rejoined: false };
  }

  /** Trả về thành viên vừa mất kết nối. Ngoài ván party, ghế được giải phóng ngay. */
  leave(peer: string): Member | null {
    const member = this.memberByPeer(peer);
    if (!member) return null;
    member.peer = null;
    if (this.stage !== 'party' || !this.lineup.includes(member.id)) {
      this.members = this.members.filter((entry) => entry !== member);
    }
    return member;
  }

  /** Chốt đội hình từ các điện thoại đang kết nối; null nếu chưa có ai. */
  startParty(): PlayerSetup[] | null {
    const online = this.members.filter((member) => member.peer);
    if (!online.length) return null;
    this.members = online;
    this.lineup = online.map((member) => member.id);
    this.stage = 'party';
    return online.map(({ name, color }) => ({ name, color }));
  }

  setLocal(): void {
    this.reset('local');
  }

  backToLobby(): void {
    this.reset('lobby');
  }

  memberByPeer(peer: string): Member | undefined {
    return this.members.find((member) => member.peer === peer);
  }

  playerIndex(memberId: string): number | null {
    const index = this.lineup.indexOf(memberId);
    return index === -1 ? null : index;
  }

  /** Điện thoại đang giữ người chơi `player`, hoặc undefined nếu không phải ván party. */
  ownerOf(player: number): Member | undefined {
    const id = this.lineup[player];
    return id ? this.members.find((member) => member.id === id) : undefined;
  }

  get connectedCount(): number {
    return this.members.filter((member) => member.peer).length;
  }

  get leaderId(): string | null {
    return this.members.find((member) => member.peer)?.id ?? null;
  }

  seat(peer: string, activePlayer: number): Seat {
    const member = this.memberByPeer(peer);
    const player = member ? this.playerIndex(member.id) : null;
    const control = this.stage === 'local'
      ? Boolean(member)
      : this.stage === 'party' && player !== null && player === activePlayer;
    return { member: member?.id ?? null, player, leader: Boolean(member) && member!.id === this.leaderId, control };
  }

  state(): PartyState {
    return {
      stage: this.stage,
      maxPlayers: this.maxPlayers,
      leader: this.leaderId,
      members: this.members.map((member) => ({
        id: member.id,
        name: member.name,
        color: member.color,
        connected: Boolean(member.peer),
        player: this.playerIndex(member.id),
      })),
    };
  }

  private reset(stage: PartyStage): void {
    this.stage = stage;
    this.lineup = [];
    this.members = this.members.filter((member) => member.peer);
  }

  private applyName(member: Member, name: string): void {
    if (name) member.name = name;
    else if (!member.name) member.name = `Người chơi ${PLAYER_COLORS.indexOf(member.color as typeof PLAYER_COLORS[number]) + 1}`;
  }
}
