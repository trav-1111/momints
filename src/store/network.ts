import { create } from 'zustand'
import { Paths, File } from 'expo-file-system'

type Cluster = 'mainnet' | 'devnet'

interface NetworkStore {
  cluster: Cluster
  setCluster: (cluster: Cluster) => void
}

const STORAGE_KEY = 'network-store'

async function readPersistedCluster(): Promise<Cluster> {
  try {
    const file = new File(Paths.document, `${STORAGE_KEY}.json`)
    if (!file.exists) return 'mainnet'
    const text = await file.text()
    const data = JSON.parse(text)
    return data?.cluster === 'devnet' ? 'devnet' : 'mainnet'
  } catch {
    return 'mainnet'
  }
}

function persistCluster(cluster: Cluster): void {
  try {
    const file = new File(Paths.document, `${STORAGE_KEY}.json`)
    file.write(JSON.stringify({ cluster }))
  } catch {
    // non-critical
  }
}

export const useNetworkStore = create<NetworkStore>()((set) => ({
  cluster: 'mainnet',
  setCluster: (cluster) => {
    persistCluster(cluster)
    set({ cluster })
  },
}))

// Load persisted cluster asynchronously on startup
readPersistedCluster().then((cluster) => {
  useNetworkStore.setState({ cluster })
})

export function getClusterRpc(cluster: Cluster): string {
  if (cluster === 'devnet') return 'https://api.devnet.solana.com'
  return process.env.EXPO_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com'
}
