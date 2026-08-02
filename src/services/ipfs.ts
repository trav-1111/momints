import { Paths, File as ExpoFile, Directory } from 'expo-file-system'
import { v4 as uuidv4 } from 'uuid'
import { PinataSDK, AuthenticationError } from 'pinata'
import type { RollContext } from '../store/mintQueue'
import type { CaptureMeta } from '../store/photos'
import { formatCapturedAt } from './captureMetadata'

function normalizeExpoPublicJwt(raw: string | undefined): string {
  let s = (raw ?? '').trim()
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim()
  }
  return s
}

const PINATA_JWT = normalizeExpoPublicJwt(process.env.EXPO_PUBLIC_PINATA_JWT)
const PINATA_GATEWAY = (process.env.EXPO_PUBLIC_PINATA_GATEWAY ?? 'gateway.pinata.cloud').trim()

const pinata = new PinataSDK({
  pinataJwt: PINATA_JWT,
  pinataGateway: PINATA_GATEWAY,
})

interface UploadParams {
  photoUri: string
  title: string
  artist: string
  capturedAt: number
  rollContext?: RollContext
  captureMeta?: CaptureMeta
}

interface UploadResult {
  imageUri: string
  metadataUri: string
  imageCid: string
  metadataCid: string
}

/** React Native FormData file field — avoids Blob/JS File (read-only `name` getter issues with Pinata). */
function rnFormDataFilePart(uri: string, filename: string, mimeType: string) {
  return { uri, name: filename, type: mimeType } as unknown as File
}

export async function uploadToIPFS(params: UploadParams): Promise<UploadResult> {
  const { photoUri, title, artist, capturedAt, rollContext, captureMeta } = params

  const safeName = `${title.replace(/\s+/g, '_')}.jpg`

  if (!PINATA_JWT) {
    throw new Error(
      'Pinata JWT missing at runtime. Add EXPO_PUBLIC_PINATA_JWT to project root .env, then restart Expo with cache clear (e.g. npx expo start --clear). Run: npm run check:pinata-env'
    )
  }

  let imageUpload: { cid: string }
  try {
    imageUpload = await pinata.upload.public.file(rnFormDataFilePart(photoUri, safeName, 'image/jpeg'))
  } catch (e) {
    const authFail =
      e instanceof AuthenticationError ||
      (e instanceof Error &&
        (/401|Not Authorized|Authentication failed/i.test(e.message) ||
          e.message.includes('Not Authorized')))
    if (authFail) {
      throw new Error(
        'Pinata rejected this JWT (401). Create a new API JWT in Pinata (app.pinata.cloud → API Keys) with permission to upload files. Put it in EXPO_PUBLIC_PINATA_JWT, run npm run check:pinata-env, then npx expo start --clear.',
        { cause: e }
      )
    }
    throw e
  }

  const imageCid = imageUpload.cid
  const imageUri = `ipfs://${imageCid}`

  const metadata = {
    name: title,
    symbol: 'MOMINT',
    description: `Shot on Seeker by ${artist}`,
    image: imageUri,
    external_url: 'https://momints.xyz',
    attributes: [
      {
        trait_type: 'Artist',
        value: artist,
      },
      {
        trait_type: 'Device',
        value: 'Solana Seeker',
      },
      {
        trait_type: 'Captured',
        value: formatCapturedAt(capturedAt),
      },
      {
        trait_type: 'Minted With',
        value: 'Momints',
      },
      ...(captureMeta?.location
        ? [{ trait_type: 'Location', value: captureMeta.location }]
        : []),
      ...(captureMeta?.weather
        ? [{ trait_type: 'Weather', value: captureMeta.weather }]
        : []),
      ...(rollContext
        ? [
            { trait_type: 'Roll', value: rollContext.rollName },
            {
              trait_type: 'Frame',
              value: `${rollContext.frameNumber} of ${rollContext.totalFrames}`,
            },
          ]
        : []),
    ],
    properties: {
      files: [
        {
          uri: imageUri,
          type: 'image/jpeg',
        },
      ],
      category: 'image',
      creators: [],
    },
  }

  const metaDir = new Directory(Paths.cache, 'momints-metadata')
  if (!metaDir.exists) {
    metaDir.create()
  }
  const tempJsonName = `${uuidv4()}.json`
  const metaFile = new ExpoFile(metaDir, tempJsonName)

  try {
    if (metaFile.exists) {
      metaFile.delete()
    }
    metaFile.create()
    metaFile.write(JSON.stringify(metadata))

    const metadataUpload = await pinata.upload.public.file(
      rnFormDataFilePart(metaFile.uri, 'metadata.json', 'application/json')
    )
    const metadataCid = metadataUpload.cid
    const metadataUri = `ipfs://${metadataCid}`

    return {
      imageUri,
      metadataUri,
      imageCid,
      metadataCid,
    }
  } catch (e) {
    const authFail =
      e instanceof AuthenticationError ||
      (e instanceof Error && (/401|Not Authorized|Authentication failed/i.test(e.message) || e.message.includes('Not Authorized')))
    if (authFail) {
      throw new Error(
        'Pinata rejected this JWT (401) on metadata upload. Regenerate the API JWT with file upload access, update .env, run npm run check:pinata-env, then npx expo start --clear.',
        { cause: e }
      )
    }
    throw e
  } finally {
    try {
      if (metaFile.exists) {
        metaFile.delete()
      }
    } catch {
      /* best-effort cleanup */
    }
  }
}

export function getIPFSGatewayUrl(ipfsUri: string): string {
  if (ipfsUri.startsWith('ipfs://')) {
    const cid = ipfsUri.replace('ipfs://', '')
    return `https://${PINATA_GATEWAY}/ipfs/${cid}`
  }
  return ipfsUri
}
