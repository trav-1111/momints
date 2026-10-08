import { create } from 'zustand'
import { File, Paths } from 'expo-file-system'

interface ContactSheetDiscoveryStore {
  hydrated: boolean
  acknowledged: boolean
  acknowledge: () => void
}

const ACK_FILE = 'contact-sheet-discovery-v1.json'

async function readAcknowledged(): Promise<boolean> {
  try {
    const file = new File(Paths.document, ACK_FILE)
    if (!file.exists) return false
    const value: unknown = JSON.parse(await file.text())
    return value !== null && typeof value === 'object' && (value as Record<string, unknown>).acknowledged === true
  } catch {
    return false
  }
}

function persistAcknowledged(): void {
  try {
    const file = new File(Paths.document, ACK_FILE)
    file.write(JSON.stringify({ acknowledged: true }))
  } catch {
    // Discovery state is a UX nicety; never interrupt the camera if persistence fails.
  }
}

export const useContactSheetDiscovery = create<ContactSheetDiscoveryStore>((set, get) => ({
  // Hide the dot until hydration completes so acknowledged devices never see a
  // one-frame flash of the nudge during startup.
  hydrated: false,
  acknowledged: true,

  acknowledge: () => {
    if (get().acknowledged) return
    persistAcknowledged()
    set({ acknowledged: true })
  },
}))

void readAcknowledged().then((acknowledged) => {
  useContactSheetDiscovery.setState({ hydrated: true, acknowledged })
})
