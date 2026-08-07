// Momints design system — "Indigo" direction (Camera app UI design, turn 3).
// Single source of truth for colors and type; screens use these via style props.

export const colors = {
  // Core
  bg: '#0c0d16',
  surface: '#14151e',
  border: '#24252f',

  // Signal accent (periwinkle indigo)
  accent: '#7d7bf0',
  accentSoft: '#b3b1ff',
  accentTint: 'rgba(125,123,240,0.14)',

  // Text tiers
  text: '#f5f5f4',
  textSoft: '#c9cacc',
  textSecondary: '#8b8d90',
  textMuted: '#6b6d70',

  // Status
  green: '#3ad07a',
  greenSoft: '#8fd8a6',
  red: '#e5544b',
  redSoft: '#e5a19b',
  redTint: 'rgba(229,84,75,0.16)',
  redBorder: 'rgba(229,84,75,0.4)',
  yellow: '#facc15',

  // Over-camera translucent chrome
  chipBg: 'rgba(0,0,0,0.5)',
  chipBorder: 'rgba(255,255,255,0.14)',
  tileBg: 'rgba(0,0,0,0.42)',
  tileBorder: 'rgba(255,255,255,0.12)',

  white: '#ffffff',
} as const

// Splash brand art: navy → plum, 158deg with soft glows
export const splashGradient = {
  colors: ['#17253f', '#101528', '#15102a', '#1b1229'] as const,
  locations: [0, 0.4, 0.74, 1] as const,
  start: { x: 0.12, y: 0 },
  end: { x: 0.88, y: 1 },
}

export const fonts = {
  sans: 'SpaceGrotesk_400Regular',
  sansMedium: 'SpaceGrotesk_500Medium',
  sansSemiBold: 'SpaceGrotesk_600SemiBold',
  sansBold: 'SpaceGrotesk_700Bold',
  mono: 'SpaceMono_400Regular',
  monoBold: 'SpaceMono_700Bold',
} as const

// letterSpacing helper: RN takes px, the design speaks in em
export const tracking = (em: number, fontSize: number) => em * fontSize
