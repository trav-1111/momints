import * as Location from 'expo-location'
import type { CaptureMeta } from '../store/photos'
import type { LocationGranularity } from '../store/locationSettings'

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/** "6:42 AM · Friday" — manual formatting to avoid Hermes Intl locale variance */
export function formatCapturedAt(ts: number): string {
  const d = new Date(ts)
  const hours24 = d.getHours()
  const minutes = d.getMinutes().toString().padStart(2, '0')
  const period = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${hours12}:${minutes} ${period} · ${WEEKDAYS[d.getDay()]}`
}

/** Shown in place of a location whenever the setting is off or resolution fails. */
export const LOCATION_PLACEHOLDER = 'Somewhere on Earth'

/** Every consumer of the Location trait/badge resolves through here, so the
 * placeholder is defined exactly once. */
export function resolveLocation(meta?: CaptureMeta): string {
  return meta?.location ?? LOCATION_PLACEHOLDER
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

// Cache the permission outcome so subsequent captures never re-prompt
let permissionGranted: boolean | null = null

async function ensurePermission(): Promise<boolean> {
  if (permissionGranted !== null) return permissionGranted
  try {
    const current = await Location.getForegroundPermissionsAsync()
    if (current.granted) {
      permissionGranted = true
    } else if (current.canAskAgain) {
      const requested = await Location.requestForegroundPermissionsAsync()
      permissionGranted = requested.granted
    } else {
      permissionGranted = false
    }
  } catch {
    permissionGranted = false
  }
  return permissionGranted
}

async function getPosition(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const last = await Location.getLastKnownPositionAsync()
    if (last) return last.coords
  } catch {
    // fall through to a fresh fix
  }
  try {
    const fresh = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
      5000
    )
    return fresh.coords
  } catch {
    return null
  }
}

async function reverseGeocode(
  latitude: number,
  longitude: number,
  granularity: 'country' | 'state' | 'city',
): Promise<string | null> {
  const results = await withTimeout(
    Location.reverseGeocodeAsync({ latitude, longitude }),
    4000
  )
  const place = results?.[0]
  if (!place) return null

  if (granularity === 'country') {
    return place.country || place.isoCountryCode || null
  }

  if (granularity === 'state') {
    return place.region || place.subregion || place.country || null
  }

  // city-level — never raw coords
  const locality = place.city || place.subregion || null
  const region = place.region || place.country || null
  const parts = [locality, region].filter((p): p is string => !!p)
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Best-effort capture-time location, at the user-chosen granularity.
 * 'off' never touches Location.* at all — no permission check, no GPS fix.
 * Never throws, never hangs past ~9s worst case. Returns {} on any failure —
 * a frame must mint fine without it.
 */
export async function captureMetadata(granularity: LocationGranularity): Promise<CaptureMeta> {
  if (granularity === 'off') return {}

  try {
    const granted = await ensurePermission()
    if (!granted) return {}

    const coords = await getPosition()
    if (!coords) return {}

    const location = await reverseGeocode(coords.latitude, coords.longitude, granularity)
    return location ? { location } : {}
  } catch {
    return {}
  }
}
