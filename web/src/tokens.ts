/** Mirror of the public CSS theme for JS consumers and design tools. */
export const tokens = {
  colors: { background: '#FFFFFF', surface: '#F8F9FA', ink: '#0B132B', accent: '#003BB5', accentHover: '#002D8F', border: '#E2E8F0', control: '#65748B', muted: '#414B60', tint: '#EEF2FF', danger: '#991B1B' },
  radius: { card: 12, container: 16 },
  spacing: { unit: 8, small: 8, medium: 16, large: 24, section: 32, wide: 48, hero: 64 },
  font: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
  controls: { minimumHeight: 56, paddingY: 16, paddingX: 24 },
} as const;
