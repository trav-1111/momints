import * as Location from 'expo-location'
import type { CaptureMeta } from '../store/photos'

// WMO weather interpretation codes as emitted by Open-Meteo
const WMO_CONDITIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Icy fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
}

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

async function reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
  const results = await withTimeout(
    Location.reverseGeocodeAsync({ latitude, longitude }),
    4000
  )
  const place = results?.[0]
  if (!place) return null
  const locality = place.city || place.subregion || null
  const region = place.region || place.country || null
  const parts = [locality, region].filter((p): p is string => !!p)
  // City-level only — if we can't name the place, omit rather than emit coords
  return parts.length > 0 ? parts.join(', ') : null
}

async function fetchWeather(latitude: number, longitude: number): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
      `&current=temperature_2m,weather_code`
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    const data = await res.json()
    const temp = data?.current?.temperature_2m
    const code = data?.current?.weather_code
    if (typeof temp !== 'number') return null
    const condition = typeof code === 'number' ? WMO_CONDITIONS[code] : undefined
    return condition ? `${Math.round(temp)}°C · ${condition}` : `${Math.round(temp)}°C`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Best-effort capture-time metadata: city-level location + current weather.
 * Never throws, never hangs past ~9s worst case. Returns {} on any failure —
 * a frame must mint fine without any of this.
 */
export async function captureMetadata(): Promise<CaptureMeta> {
  try {
    const granted = await ensurePermission()
    if (!granted) return {}

    const coords = await getPosition()
    if (!coords) return {}

    const [locationResult, weatherResult] = await Promise.allSettled([
      reverseGeocode(coords.latitude, coords.longitude),
      fetchWeather(coords.latitude, coords.longitude),
    ])

    const meta: CaptureMeta = {}
    if (locationResult.status === 'fulfilled' && locationResult.value) {
      meta.location = locationResult.value
    }
    if (weatherResult.status === 'fulfilled' && weatherResult.value) {
      meta.weather = weatherResult.value
    }
    return meta
  } catch {
    return {}
  }
}
