import type { PlayerSetup } from './types';

/** Trần chung của cả kho; mỗi game tự đặt giới hạn riêng trong `hub/gameCatalog.ts`. */
export const MAX_PLAYERS = 8;

/** Màu đầu tiên trùng màu bóng gốc để chế độ một người giữ nguyên diện mạo. Mỗi người một màu nên cần ít nhất MAX_PLAYERS màu. */
export const PLAYER_COLORS = ['#ff5caf', '#4cc9ff', '#ffc23d', '#58e39a', '#a98bff', '#ff8a4c', '#ff5a5a', '#eceaf4'] as const;

export function defaultPlayers(count: number): PlayerSetup[] {
  const total = Math.max(1, Math.min(MAX_PLAYERS, Math.round(count)));
  return Array.from({ length: total }, (_, index) => ({
    name: total === 1 ? 'Bạn' : `Người chơi ${index + 1}`,
    color: PLAYER_COLORS[index % PLAYER_COLORS.length]!,
  }));
}

/** Tên do điện thoại gửi lên: bỏ ký tự điều khiển/HTML, gộp khoảng trắng, tối đa 16 ký tự hiển thị. */
export function sanitizePlayerName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const cleaned = value.normalize('NFC').replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(cleaned).slice(0, 16).join('').trim();
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const last = words.at(-1) ?? '?';
  return (Array.from(last)[0] ?? '?').toUpperCase();
}
