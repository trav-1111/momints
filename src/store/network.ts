// Mainnet only. A devnet/mainnet toggle used to live here (splash screen +
// camera wallet menu) — removed with the mainnet cutover: the Worker is a
// single deployed backend, so once it points at mainnet a devnet-mode app
// could never successfully create a roll or quick mint anyway.
export function getClusterRpc(): string {
  return process.env.EXPO_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com'
}
