export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'pocket-arcade-theme';
const THEME_EVENT = 'pocket-theme-change';

const isThemeMode = (value: string | null): value is ThemeMode => value === 'light' || value === 'dark';

export const getTheme = (): ThemeMode => {
  const active = document.documentElement.dataset.theme;
  return active === 'light' ? 'light' : 'dark';
};

const refreshControls = (): void => {
  const theme = getTheme();
  const nextLabel = theme === 'dark' ? 'Chuyển sang chế độ sáng' : 'Chuyển sang chế độ tối';
  document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((button) => {
    button.setAttribute('aria-label', nextLabel);
    button.setAttribute('title', nextLabel);
    button.setAttribute('aria-pressed', String(theme === 'light'));
    const icon = button.querySelector<HTMLElement>('[data-theme-icon]');
    const label = button.querySelector<HTMLElement>('[data-theme-label]');
    if (icon) icon.textContent = theme === 'dark' ? '☀' : '☾';
    if (label) label.textContent = theme === 'dark' ? 'Chế độ sáng' : 'Chế độ tối';
  });
};

export const setTheme = (theme: ThemeMode, persist = true): void => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  if (persist) localStorage.setItem(STORAGE_KEY, theme);
  refreshControls();
  window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_EVENT, { detail: theme }));
};

export const initTheme = (): ThemeMode => {
  const stored = localStorage.getItem(STORAGE_KEY);
  const theme = isThemeMode(stored)
    ? stored
    : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  setTheme(theme, false);
  return theme;
};

export const bindThemeToggle = (root: ParentNode): void => {
  root.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'));
  });
  refreshControls();
};

export const onThemeChange = (listener: (theme: ThemeMode) => void): (() => void) => {
  const handler = (event: Event): void => listener((event as CustomEvent<ThemeMode>).detail);
  window.addEventListener(THEME_EVENT, handler);
  return () => window.removeEventListener(THEME_EVENT, handler);
};
