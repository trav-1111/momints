import { create } from 'zustand'
import { Paths, File } from 'expo-file-system'

export type LocationGranularity = 'off' | 'country' | 'state' | 'city'

interface LocationSettingsStore {
  granularity: LocationGranularity
  setGranularity: (granularity: LocationGranularity) => void
}

const STORAGE_KEY = 'location-settings-store'

function parseGranularity(value: unknown): LocationGranularity {
  return value === 'country' || value === 'state' || value === 'city' ? value : 'off'
}

async function readPersistedGranularity(): Promise<LocationGranularity> {
  try {
    const file = new File(Paths.document, `${STORAGE_KEY}.json`)
    if (!file.exists) return 'off'
    const text = await file.text()
    const data = JSON.parse(text)
    return parseGranularity(data?.granularity)
  } catch {
    return 'off'
  }
}

function persistGranularity(granularity: LocationGranularity): void {
  try {
    const file = new File(Paths.document, `${STORAGE_KEY}.json`)
    file.write(JSON.stringify({ granularity }))
  } catch {
    // non-critical
  }
}

export const useLocationSettingsStore = create<LocationSettingsStore>()((set) => ({
  granularity: 'off',
  setGranularity: (granularity) => {
    persistGranularity(granularity)
    set({ granularity })
  },
}))

// Load persisted granularity asynchronously on startup — defaults to 'off'
// until this resolves, so no capture in flight before hydration ever picks
// up a granularity the user didn't actively choose this session.
readPersistedGranularity().then((granularity) => {
  useLocationSettingsStore.setState({ granularity })
})
