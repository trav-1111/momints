export type FilmStockId =
  | 'standard-color'
  | 'standard-bw'
  | 'momints-aura-400'
  | 'momints-neon-800t'
  | 'momints-vivid-50'
  | 'momints-amber-200'
  | 'momints-silver-400'
  | 'momints-bali-400'
  | 'momints-martha'
  // Legacy aliases for stored user sessions & worker catalogue IDs
  | 'kodak-portra-400'
  | 'cinestill-800t'
  | 'fuji-velvia-50'
  | 'kodak-gold-200'
  | 'kodak-tri-x-400'
  | 'bali-400-v1'
  | 'bali-400'
  | 'martha-v1'
  | 'martha'

export interface FilmStockConfig {
  id: FilmStockId
  name: string
  shortName: string
  manufacturer: 'Momints Lab' | 'Standard'
  tagline: string
  description: string
  mode: 'color' | 'bw'
  iso: number
  type: 'Color Negative' | 'Color Reversal' | 'Motion Picture' | 'Black & White' | 'Standard'
  lutAsset?: number | string
  grain: {
    intensity: number
    size: number
  }
  halation?: {
    intensity: number
    radius: number
  }
}

export const FILM_STOCKS: readonly FilmStockConfig[] = [
  {
    id: 'momints-aura-400',
    name: 'Momints Aura 400',
    shortName: 'AURA 400',
    manufacturer: 'Momints Lab',
    tagline: 'Warm skin tones & gentle pastel roll-off',
    description: 'Portrait film simulation. Soft highlights and warm skin tones.',
    mode: 'color',
    iso: 400,
    type: 'Color Negative',
    lutAsset: require('../../assets/luts/momints-aura-400.png'),
    grain: { intensity: 0.08, size: 1.8 },
  },
  {
    id: 'momints-neon-800t',
    name: 'Momints Neon 800T',
    shortName: 'NEON 800T',
    manufacturer: 'Momints Lab',
    tagline: 'Tungsten-balanced with red halation bloom',
    description: 'Cinematic motion picture emulsion. Glowing red halation bloom around specular highlights.',
    mode: 'color',
    iso: 800,
    type: 'Motion Picture',
    lutAsset: require('../../assets/luts/momints-neon-800t.png'),
    grain: { intensity: 0.12, size: 2.0 },
    halation: { intensity: 0.45, radius: 12.0 },
  },
  {
    id: 'momints-vivid-50',
    name: 'Momints Vivid 50',
    shortName: 'VIVID 50',
    manufacturer: 'Momints Lab',
    tagline: 'Hyper-vivid landscapes & saturated colors',
    description: 'Ultra-saturated slide film simulation. Vibrant colors, deep rich blacks, and ultra-fine grain.',
    mode: 'color',
    iso: 50,
    type: 'Color Reversal',
    lutAsset: require('../../assets/luts/momints-vivid-50.png'),
    grain: { intensity: 0.04, size: 1.4 },
  },
  {
    id: 'momints-amber-200',
    name: 'Momints Amber 200',
    shortName: 'AMBER 200',
    manufacturer: 'Momints Lab',
    tagline: 'Golden hour warmth & vintage punch',
    description: 'Classic color negative look. Warm golden amber tones with nostalgic vintage snapshot character.',
    mode: 'color',
    iso: 200,
    type: 'Color Negative',
    lutAsset: require('../../assets/luts/momints-amber-200.png'),
    grain: { intensity: 0.1, size: 2.0 },
  },
  {
    id: 'momints-silver-400',
    name: 'Momints Silver 400',
    shortName: 'SILVER 400',
    manufacturer: 'Momints Lab',
    tagline: 'Dramatic documentary contrast & prominent grain',
    description: 'Classic photojournalism monochrome. Deep punchy blacks and iconic silver halide grain structure.',
    mode: 'bw',
    iso: 400,
    type: 'Black & White',
    lutAsset: require('../../assets/luts/momints-silver-400.png'),
    grain: { intensity: 0.14, size: 2.2 },
  },
  {
    id: 'momints-bali-400',
    name: 'Momints Bali 400',
    shortName: 'BALI 400',
    manufacturer: 'Momints Lab',
    tagline: 'Warm, nostalgic colour & dense shadows',
    description: 'Warm skin tones, restrained highlights, muted greens, and subtle grain.',
    mode: 'color',
    iso: 400,
    type: 'Color Negative',
    lutAsset: require('../../assets/luts/momints-bali-400.png'),
    grain: { intensity: 0.13, size: 1.9 },
    halation: { intensity: 0.025, radius: 10.0 },
  },
  {
    id: 'momints-martha',
    name: 'Momints Martha',
    shortName: 'MARTHA',
    manufacturer: 'Momints Lab',
    tagline: 'Lush saturation, rich colors & vintage tone',
    description: 'Lush saturation, rich colors, lifted blacks, and vintage tone.',
    mode: 'color',
    iso: 400,
    type: 'Color Negative',
    lutAsset: require('../../assets/luts/momints-martha.png'),
    grain: { intensity: 0.12, size: 1.8 },
  },
  {
    id: 'standard-color',
    name: 'Standard Color',
    shortName: 'COLOR',
    manufacturer: 'Standard',
    tagline: 'Unprocessed digital capture',
    description: 'Clean, unfiltered native sensor capture with no film simulation.',
    mode: 'color',
    iso: 100,
    type: 'Standard',
    grain: { intensity: 0.0, size: 1.0 },
  },
  {
    id: 'standard-bw',
    name: 'Standard B&W',
    shortName: 'B&W',
    manufacturer: 'Standard',
    tagline: 'Rec. 601 grayscale matrix',
    description: 'Clean neutral digital black and white conversion without analog grain.',
    mode: 'bw',
    iso: 100,
    type: 'Standard',
    grain: { intensity: 0.0, size: 1.0 },
  },
] as const

export const DEFAULT_FILM_STOCK_ID: FilmStockId = 'momints-aura-400'

const LEGACY_ID_MAP: Record<string, FilmStockId> = {
  'kodak-portra-400': 'momints-aura-400',
  'cinestill-800t': 'momints-neon-800t',
  'fuji-velvia-50': 'momints-vivid-50',
  'kodak-gold-200': 'momints-amber-200',
  'kodak-tri-x-400': 'momints-silver-400',
  'bali-400-v1': 'momints-bali-400',
  'bali-400': 'momints-bali-400',
  'martha-v1': 'momints-martha',
  'martha': 'momints-martha',
}

export function getFilmStock(stockId?: string | null): FilmStockConfig {
  if (!stockId) return FILM_STOCKS[0]
  const resolvedId = LEGACY_ID_MAP[stockId] ?? stockId
  const found = FILM_STOCKS.find((s) => s.id === resolvedId)
  return found ?? FILM_STOCKS[0]
}
