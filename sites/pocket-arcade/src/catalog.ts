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

/**
 * Địa chỉ site của một game. Dev: cùng máy, cổng dev của site đó. Bản build: '/<id>/' trên cùng tên miền
 * (khớp server production). Deploy mỗi site một tên miền thì đặt VITE_SITE_<ID>_URL.
 */
export function siteUrl(game: SiteMeta): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const configured = env[`VITE_SITE_${game.id.toUpperCase()}_URL`];
  if (configured) return configured;
  return import.meta.env.DEV ? `${location.protocol}//${location.hostname}:${game.devPort}/` : new URL(`/${game.id}/`, location.href).href;
}

export function playerCountLabel(limits: PlayerLimits): string {
  return limits.max === 1 ? '1 người' : `1–${limits.max} người`;
}
