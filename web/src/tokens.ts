/** Mirror of the public CSS theme for JS consumers and design tools. */
export const tokens = {
  colors: { background: '#FFFFFF', surface: '#F4F6FA', ink: '#0B132B', accent: '#003BB5', accentHover: '#002D8F', border: '#DCE1E8', control: '#68768A', muted: '#3E4C63', tint: '#EEF2FF', danger: '#991B1B' },
  radius: { card: 16, container: 20 },
  spacing: { unit: 8, small: 8, medium: 16, large: 24, section: 32, wide: 48, hero: 64 },
  font: '"Poppins", sans-serif',
  controls: { minimumHeight: 44, paddingY: 12, paddingX: 16 },
} as const;
