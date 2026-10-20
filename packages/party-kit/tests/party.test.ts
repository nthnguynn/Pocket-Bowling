import { describe, expect, it } from 'vitest';
import { PartyRoom } from '../src/party/PartyRoom';
import { MAX_PLAYERS, PLAYER_COLORS, sanitizePlayerName } from '../src/players';

const CLIENT_A = 'client-aaaaaaaa';
const CLIENT_B = 'client-bbbbbbbb';
const CLIENT_C = 'client-cccccccc';

describe('sảnh chờ party', () => {
  it('gán màu riêng, tên mặc định và chủ phòng là người vào đầu tiên', () => {
    const party = new PartyRoom();
    party.join('peer-a', CLIENT_A, 'Lan');
    party.join('peer-b', CLIENT_B, '');
    const state = party.state();
    expect(state.members.map((member) => member.name)).toEqual(['Lan', 'Người chơi 2']);
    expect(new Set(state.members.map((member) => member.color)).size).toBe(2);
    expect(state.leader).toBe(state.members[0]!.id);
    expect(party.seat('peer-a', 0).leader).toBe(true);
    expect(party.seat('peer-b', 0).leader).toBe(false);
  });

  it('chặn người thứ 7 nhưng vẫn cho người cũ nối lại', () => {
    const party = new PartyRoom(2);
    party.join('peer-a', CLIENT_A, 'A');
    party.join('peer-b', CLIENT_B, 'B');
    expect(party.join('peer-c', CLIENT_C, 'C').member).toBeNull();
    party.leave('peer-a');
    expect(party.join('peer-c', CLIENT_C, 'C').member).not.toBeNull();
  });

  it('chỉ điện thoại của người đang tới lượt được điều khiển', () => {
    const party = new PartyRoom();
    party.join('peer-a', CLIENT_A, 'A');
    party.join('peer-b', CLIENT_B, 'B');
    expect(party.seat('peer-a', 0).control).toBe(false);
    expect(party.startParty()).toEqual([
      { name: 'A', color: PLAYER_COLORS[0] },
      { name: 'B', color: PLAYER_COLORS[1] },
    ]);
    expect(party.seat('peer-a', 0)).toMatchObject({ player: 0, control: true });
    expect(party.seat('peer-b', 0)).toMatchObject({ player: 1, control: false });
    expect(party.seat('peer-b', 1).control).toBe(true);
  });

  it('giữ ghế khi rớt mạng giữa ván và trả lại khi cùng tab nối lại', () => {
    const party = new PartyRoom();
    party.join('peer-a', CLIENT_A, 'A');
    party.join('peer-b', CLIENT_B, 'B');
    party.startParty();
    party.leave('peer-b');
    expect(party.ownerOf(1)?.peer).toBeNull();
    expect(party.state().members[1]).toMatchObject({ connected: false, player: 1 });
    party.join('peer-b2', CLIENT_B, '');
    expect(party.seat('peer-b2', 1)).toMatchObject({ player: 1, control: true });
    expect(party.ownerOf(1)?.name).toBe('B');
  });

  it('người vào giữa ván chờ ván sau, và được xếp vào khi chơi lại', () => {
    const party = new PartyRoom();
    party.join('peer-a', CLIENT_A, 'A');
    party.startParty();
    party.join('peer-c', CLIENT_C, 'C');
    expect(party.seat('peer-c', 0)).toMatchObject({ player: null, control: false });
    expect(party.startParty()?.map((player) => player.name)).toEqual(['A', 'C']);
  });

  it('chế độ chơi trên máy host: mọi điện thoại là tay cầm chung', () => {
    const party = new PartyRoom();
    party.join('peer-a', CLIENT_A, 'A');
    party.join('peer-b', CLIENT_B, 'B');
    party.setLocal();
    expect(party.seat('peer-a', 1).control).toBe(true);
    expect(party.seat('peer-b', 0).control).toBe(true);
    expect(party.seat('peer-unknown', 0).control).toBe(false);
  });

  it('một kết nối không thể đổi sang danh tính của người khác', () => {
    const party = new PartyRoom();
    party.join('peer-a', CLIENT_A, 'A');
    party.join('peer-b', CLIENT_B, 'B');
    party.join('peer-b', CLIENT_A, 'Giả mạo');
    expect(party.memberByPeer('peer-a')?.name).toBe('A');
    expect(party.memberByPeer('peer-b')?.name).toBe('Giả mạo');
    expect(party.state().members).toHaveLength(2);
  });
});

describe('tên và màu người chơi', () => {
  it('làm sạch tên do điện thoại gửi lên', () => {
    expect(sanitizePlayerName('  <b>Lan</b>\n  ')).toBe('bLan/b');
    expect(sanitizePlayerName('Nguyễn   Thị  Minh Khai rất dài')).toBe('Nguyễn Thị Minh');
    expect(sanitizePlayerName(42)).toBe('');
  });

  it('đủ màu khác nhau cho số người tối đa', () => {
    expect(PLAYER_COLORS.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
    expect(new Set(PLAYER_COLORS).size).toBe(PLAYER_COLORS.length);
  });

  it('phòng 8 người: mỗi người một màu, người thứ 9 chỉ được xem', () => {
    const party = new PartyRoom(8);
    for (let index = 0; index < 8; index += 1) {
      expect(party.join(`peer-${index}`, `client-${index}-xxxxxxxx`, '').member).not.toBeNull();
    }
    const state = party.state();
    expect(new Set(state.members.map((member) => member.color)).size).toBe(8);
    expect(state.members.at(-1)!.name).toBe('Người chơi 8');
    expect(party.join('peer-9', 'client-9-xxxxxxxx', 'Muộn')).toMatchObject({ member: null });
  });
});
