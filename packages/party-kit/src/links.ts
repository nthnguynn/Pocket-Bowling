/** Cổng dev mặc định của trang kho game (sites/pocket-arcade). */
export const ARCADE_DEV_PORT = 5173;

/**
 * Địa chỉ trang kho game. Dev: cùng máy, cổng 5173. Bản build: gốc của cùng tên miền (server production
 * phục vụ kho game ở '/' và mỗi game ở '/<id>/'). Deploy mỗi site một tên miền thì đặt VITE_ARCADE_URL.
 */
export function arcadeUrl(): string {
  const configured = import.meta.env.VITE_ARCADE_URL as string | undefined;
  if (configured) return configured;
  return import.meta.env.DEV ? `${location.protocol}//${location.hostname}:${ARCADE_DEV_PORT}/` : new URL('/', location.href).href;
}
