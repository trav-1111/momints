import type { ReactNode } from 'react'
import Svg, { G, Path, Rect, Circle, Line } from 'react-native-svg'
import { colors } from '../theme'

// Mechanical icon language — 24px grid, round caps and joins, stroke follows
// color. Weights: 1.6 default, heavier for small badge sizes. From the icon
// spec sheet in "Camera app UI design" (emoji → analog set).

export interface IconProps {
  size?: number
  color?: string
  strokeWidth?: number
}

function IconBase({
  size = 24,
  color = colors.text,
  strokeWidth = 1.6,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {children}
      </G>
    </Svg>
  )
}

/** Quick mode — aperture-bodied camera (never confused with flash). */
export function IconCamera(p: IconProps) {
  return (
    <IconBase {...p}>
      <Rect x="2.5" y="6.5" width="19" height="13.5" rx="2.5" />
      <Path d="M8 6.5l1.4-2.3h5.2L16 6.5" />
      <Circle cx="12" cy="13.2" r="3.6" />
    </IconBase>
  )
}

/** Roll / film canister — chips, cards, badges. */
export function IconFilm(p: IconProps) {
  return (
    <IconBase {...p}>
      <Rect x="5.5" y="3.5" width="8.5" height="17" rx="1.8" />
      <Line x1="8" y1="3.5" x2="8" y2="20.5" />
      <Line x1="11.5" y1="3.5" x2="11.5" y2="20.5" />
      <Path d="M14 8.5h3.2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H14" />
    </IconBase>
  )
}

/** Flash on — the bolt belongs to flash alone. */
export function IconBolt(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M13 2.5 5.5 13.5H11l-1 8L18.5 10H12z" />
    </IconBase>
  )
}

/** Flash off — dimmed bolt with a slash. */
export function IconBoltOff(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M13 2.5 5.5 13.5H11l-1 8L18.5 10H12z" opacity={0.4} />
      <Line x1="4" y1="3.5" x2="20" y2="20.5" />
    </IconBase>
  )
}

/** Flip camera — circular arrows. */
export function IconFlip(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M4 12a8 8 0 0 1 13.5-5.8L20 8" />
      <Path d="M20 3.5V8h-4.5" />
      <Path d="M20 12a8 8 0 0 1-13.5 5.8L4 16" />
      <Path d="M4 20.5V16h4.5" />
    </IconBase>
  )
}

/** Gallery / review. */
export function IconGallery(p: IconProps) {
  return (
    <IconBase {...p}>
      <Rect x="4" y="4" width="16" height="16" rx="2.5" />
      <Circle cx="9" cy="9.5" r="1.8" />
      <Path d="M4 16l4.5-4 3.5 3 4-4.5L20 15" />
    </IconBase>
  )
}

/** Mint — faceted diamond. */
export function IconMint(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M6 4h12l3.5 5-9.5 11L2.5 9z" />
      <Path d="M6 4l3 5h6l3-5" />
      <Path d="M2.5 9h19" />
      <Path d="M9 9l3 11 3-11" />
    </IconBase>
  )
}

/** Save to device — down arrow into tray. */
export function IconSave(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M12 3.5v10" />
      <Path d="M8 10l4 4 4-4" />
      <Path d="M4 15v3.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </IconBase>
  )
}

/** Delete. */
export function IconTrash(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M4 6.5h16" />
      <Path d="M9 6.5V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <Path d="M6 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4l1-13" />
    </IconBase>
  )
}

/** Develop — film developing tank (not a flask). */
export function IconDevelop(p: IconProps) {
  return (
    <IconBase {...p}>
      <Rect x="6" y="7" width="12" height="14" rx="2.5" />
      <Path d="M8 7V5.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1V7" />
      <Line x1="12" y1="2.5" x2="12" y2="4.5" />
      <Line x1="9.5" y1="2.5" x2="14.5" y2="2.5" />
      <Line x1="6" y1="12" x2="18" y2="12" />
    </IconBase>
  )
}

/** Location — mint-form badge. */
export function IconPin(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" />
      <Circle cx="12" cy="10" r="2.6" />
    </IconBase>
  )
}

/** Shot on Seeker — phone, mint-form badge. */
export function IconPhone(p: IconProps) {
  return (
    <IconBase {...p}>
      <Rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <Line x1="10" y1="5" x2="14" y2="5" />
      <Circle cx="12" cy="18" r="0.6" fill={p.color ?? colors.text} stroke="none" />
    </IconBase>
  )
}

/** Wallet — status pill and menu. */
export function IconWallet(p: IconProps) {
  return (
    <IconBase {...p}>
      <Rect x="3" y="6" width="18" height="13" rx="2.5" />
      <Path d="M3 9.5h18" />
      <Circle cx="16.5" cy="13" r="1.4" />
    </IconBase>
  )
}

/** Aspect / crop control. */
export function IconAspect(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M7 3v14h14" />
      <Path d="M3 7h14v14" />
    </IconBase>
  )
}

/** Back chevron. */
export function IconBack(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M15 5l-7 7 7 7" />
    </IconBase>
  )
}

/** Forward arrow — proceed buttons. */
export function IconArrowRight(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M5 12h14M13 6l6 6-6 6" />
    </IconBase>
  )
}

/** Check — selection state. */
export function IconCheck(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M5 12.5l4.5 4.5L19 7" />
    </IconBase>
  )
}
