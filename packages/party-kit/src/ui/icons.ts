/**
 * Icon SVG nhúng thẳng vào HTML. Ký hiệu Unicode như ⌂ ▣ ⤢ ☾ không có trong nhiều font
 * (TV, Android đời cũ) nên hiện thành ô vuông; SVG thì luôn hiện đúng và đổi màu theo chữ.
 */
const PATHS = {
  home: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9h11v-9"/><path d="M10 19v-5h4v5"/>',
  players: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.8 14.6c2.4-.2 4.2 1.2 4.7 3.9"/>',
  network: '<path d="M5 18v-3"/><path d="M10 18v-6"/><path d="M15 18V9"/><path d="M20 18V6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  expand: '<path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path d="M20 4l-7 7"/><path d="M4 20l7-7"/>',
  collapse: '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M10 14l-6 6"/><path d="M14 10l6-6"/>',
  left: '<path d="M15 5 8 12l7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
} as const;

export type UiIconName = keyof typeof PATHS;

export function uiIcon(name: UiIconName): string {
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}
