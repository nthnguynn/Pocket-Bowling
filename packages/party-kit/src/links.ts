/** Cổng dev mặc định của trang kho game (sites/pocket-arcade). */
export const ARCADE_DEV_PORT = 5173;

/**
 * Địa chỉ trang kho game. Mỗi game là một site riêng (cổng/tên miền riêng) nên không dùng được "./":
 * đặt VITE_ARCADE_URL khi deploy, còn khi dev thì là cùng máy, cổng 5173.
 */
export function arcadeUrl(): string {
  const configured = import.meta.env.VITE_ARCADE_URL as string | undefined;
  return configured || `${location.protocol}//${location.hostname}:${ARCADE_DEV_PORT}/`;
}
