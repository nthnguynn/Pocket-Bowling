import { meta as bowling } from '@pocket/bowling/meta';
import { meta as marble } from '@pocket/marble/meta';
import { meta as roll } from '@pocket/roll/meta';
import { meta as sumo } from '@pocket/sumo/meta';
import type { PlayerLimits, SiteMeta } from '@pocket/party-kit';

/**
 * Các game trong kho, game mới nhất trước. Thông tin lấy từ src/meta.ts của từng site:
 * thêm game = tạo site mới trong sites/ rồi thêm một dòng ở đây. Kho game chỉ đọc meta, không chạm vào code game.
 */
export const GAMES: SiteMeta[] = [roll, sumo, bowling, marble];

/** Địa chỉ site của một game: VITE_SITE_<ID>_URL khi deploy, còn khi dev là cùng máy, cổng dev của site đó. */
export function siteUrl(game: SiteMeta): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[`VITE_SITE_${game.id.toUpperCase()}_URL`] || `${location.protocol}//${location.hostname}:${game.devPort}/`;
}

export function playerCountLabel(limits: PlayerLimits): string {
  return limits.max === 1 ? '1 người' : `1–${limits.max} người`;
}
