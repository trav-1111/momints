import {
  address,
  createSolanaRpc,
  getAddressEncoder,
  getBase64Decoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
  type Address,
  type Base58EncodedBytes,
} from '@solana/kit'
import { sha256 } from '@noble/hashes/sha2.js'

const ANS_PROGRAM = address('ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK')
const TLD_HOUSE_PROGRAM = address('TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S')
const ROOT_ANS = address('3mX9b4AZaQehNoQGfckVcmgmA6bkBoFcbLj9RMmMyNcU')
const HASH_PREFIX = 'ALT Name Service'
const TLD = '.skr'
const OWNER_OFFSET = 40
const EXPIRES_AT_OFFSET = 104
const HEADER_SIZE = 200
const timeoutMs = 8_000
const utf8Encoder = getUtf8Encoder()
const addressEncoder = getAddressEncoder()

const zero = new Uint8Array(32)

const hashName = (name: string) => sha256(new Uint8Array(utf8Encoder.encode(HASH_PREFIX + name)))
const pda = (program: Address, seeds: Uint8Array[]) =>
  getProgramDerivedAddress({ programAddress: program, seeds }).then(([result]) => result)
const nameAccount = (name: string, parent?: Address) =>
  pda(ANS_PROGRAM, [hashName(name), zero, parent ? new Uint8Array(addressEncoder.encode(parent)) : zero])
const tldHouse = () =>
  pda(TLD_HOUSE_PROGRAM, [new Uint8Array(utf8Encoder.encode('tld_house')), new Uint8Array(utf8Encoder.encode(TLD))])
const decode = (data: unknown): Uint8Array | null => {
  if (!Array.isArray(data) || typeof data[0] !== 'string') return null
  try {
    const binary = atob(data[0])
    return Uint8Array.from(binary, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

export async function resolveSkrNames(rpcUrl: string, ownerString: string): Promise<string[]> {
  const owner = address(ownerString)
  const parent = await nameAccount(TLD, ROOT_ANS)
  const rpc = createSolanaRpc(rpcUrl)
  const accounts = await withTimeout(
    rpc
      .getProgramAccounts(ANS_PROGRAM, {
        encoding: 'base64',
        dataSlice: { offset: EXPIRES_AT_OFFSET, length: 8 },
        filters: [
          { memcmp: { offset: 8n, bytes: parent as string as Base58EncodedBytes, encoding: 'base58' } },
          {
            memcmp: { offset: BigInt(OWNER_OFFSET), bytes: owner as string as Base58EncodedBytes, encoding: 'base58' },
          },
        ],
      })
      .send(),
  )
  const now = Date.now()
  const live = accounts.filter(({ account }) => {
    const data = decode(account.data)
    if (!data || data.length < 8) return false
    const expires = Number(new DataView(data.buffer, data.byteOffset, 8).getBigUint64(0, true))
    return expires === 0 || expires * 1000 >= now
  })
  const house = await tldHouse()
  const names: string[] = []
  for (let i = 0; i < live.length; i += 100) {
    const pdas = await Promise.all(
      live
        .slice(i, i + 100)
        .map(({ pubkey }) => pda(ANS_PROGRAM, [hashName(pubkey), new Uint8Array(addressEncoder.encode(house)), zero])),
    )
    const { value } = await withTimeout(rpc.getMultipleAccounts(pdas, { encoding: 'base64' }).send())
    for (const entry of value) {
      if (!entry) continue
      const data = decode(entry.data)
      if (!data || data.length <= HEADER_SIZE) continue
      const label = new TextDecoder().decode(data.subarray(HEADER_SIZE)).replace(/\0.*$/, '')
      if (/^[a-z0-9-]{1,63}$/i.test(label)) names.push(`${label}${TLD}`)
    }
  }
  return names.sort()
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('resolver timeout')), timeoutMs)),
  ])
}
