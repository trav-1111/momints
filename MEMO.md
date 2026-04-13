# Momints Session Memo

## Current Progress

### Core App Features (Complete)

- **Camera Screen** (`src/app/camera.tsx`)
  - Photo capture with Vision Camera
  - Flash toggle (back camera only, with `supportsFlash` check)
  - Tap-to-focus with animated indicator
  - Pinch-to-zoom with gesture handling (preserves zoom between gestures)
  - Camera flip (front/back)
  - Wallet connection via `@wallet-ui/react-native-kit`
  - **Domain resolution (`.skr` only)** — Metasal reverse lookup; if no `.skr` domain, UI shows the usual truncated address

- **Review Screen** (`src/app/review.tsx`)
  - Swipe/bulk flow after capture: save to gallery, delete, or mark to mint

- **Photo Gallery** (`src/app/gallery.tsx`)
  - Grid view of captured photos
  - Navigation to editor and mint form

- **Photo Editor** (`src/app/editor/[id].tsx`)
  - Fine-grained rotation (1-degree increments via slider)
  - Coarse rotation (90-degree buttons)
  - Alignment grid overlay
  - Cropping with aspect ratio presets (Free, 1:1, 4:3, 16:9)
  - Save to camera roll via `expo-media-library`

- **Minting Flow** (`src/app/mint/`)
  - Metadata form for NFT title/artist
  - Progress screen with status indicators (upload → sign in wallet → mint → confirm)
  - IPFS upload via Pinata
  - **On-chain mint** via Metaplex Token Metadata (`createNft`) + partial sign (new mint keypair) + wallet `signTransaction` + **app RPC** send/confirm (`EXPO_PUBLIC_SOLANA_RPC`)

---

## State of the Code

### Recent changes (mint / IPFS / RPC)

1. **Metadata IPFS upload** (`src/services/ipfs.ts`) — Metadata is written to a temp file under `Paths.cache/momints-metadata`, then uploaded with the same `{ uri, name, type }` shape as the image. Avoids `new File(...)` on Hermes/RN (read-only `File.name` → `Cannot assign to property 'name' which has only a getter`).

2. **App-controlled Solana broadcast** (`src/services/mint.ts`, `src/hooks/useMint.ts`) — Mint uses wallet **`signTransaction`** only, then **`sendTransactionWithoutConfirmingFactory({ rpc: client.rpc })`** from `@solana/kit` plus polling confirmation. **`signAndSendTransaction`** from the kit is **not** used for mint: MWA `signAndSend` submits via the **wallet app's** RPC (e.g. Seeker default), which caused **"Network request failed"** after returning from the wallet even when Pinata uploads succeeded. App send uses the same RPC as `MobileWalletProvider` / `EXPO_PUBLIC_SOLANA_RPC`.

3. **Mint diagnostics** — Errors are wrapped with phase prefixes (`Mint: wallet sign failed`, `RPC send`, `confirmation`, etc.) and `__DEV__` logs use `[mint:…]` (no RPC URLs or secrets in logs).

4. **Metadata URIs use `ipfs://`** — On-chain `uri`, metadata JSON `image`, and `properties.files[].uri` all use `ipfs://CID` format. Wallets (Seeker, Phantom) resolve these natively through their own IPFS gateways. An earlier attempt to use HTTPS Pinata dedicated-gateway URLs failed — Pinata's restricted gateway returned `ERR_ID:00024` when wallets/browsers tried to fetch the content, which broke both the image and all metadata properties. The `getIPFSGatewayUrl()` helper in `ipfs.ts` remains available for **in-app display** only.

### App flow status: functional

End-to-end minting on mainnet via Seeker is working: camera capture → review → metadata form → IPFS upload (image + JSON) → wallet sign → app-side RPC send/confirm → on-chain NFT with image and full metadata properties (description, artist, device, captured date, minted-with).

### Open items

1. **No priority fees / compute budget** — Mint transaction does not set compute unit limit or price; **congested mainnet** may cause failed simulation, slow landing, or timeouts.

2. **Wallet errors not differentiated** — User **dismisses** the signing sheet vs **network/protocol** errors may all surface as `Mint: wallet sign failed` without tailored copy.

3. **Secrets in the client** — `EXPO_PUBLIC_PINATA_JWT` and `EXPO_PUBLIC_SOLANA_RPC` (often including a **Helius API key** in the URL) are bundled into the app; anyone can extract them. Acceptable for prototyping with rotation; **not** ideal for production.

4. **Lint noise** — `npm run lint:check` reports existing warnings: unused `removePhoto` in `src/app/gallery.tsx`, `Array<T>` style in `src/app/review.tsx`.

### Proposed improvements (prioritized)

| Priority | Item | Notes |
|----------|------|--------|
| High | **Compute budget + priority fee** on mint tx | Add `SetComputeUnitLimit` / `SetComputeUnitPrice` (or Helius priority-fee estimate) before Metaplex instructions; biggest win for mainnet reliability. |
| Medium | **User-cancel vs error** | Inspect MWA / kit error types where available; show "You cancelled signing" vs generic failure. |
| Production | **Backend proxy** | Short-lived Pinata upload JWT; RPC proxy or server-side Sender so keys are not in `EXPO_PUBLIC_*`. |
| Later | **Helius Sender** | Optional HTTPS Sender path for contested landing (separate from vanilla `sendTransaction`). |
| Later | **Public gateway for Solscan** | Pinata dedicated gateways are restricted; Solscan/marketplaces may not render `ipfs://` images. If broader explorer/marketplace visibility is needed, upload to a **public** gateway (e.g. Pinata public, nftstorage, Arweave) or configure the Pinata gateway for open access. |

### Known limitations (unchanged product scope)

1. **Mint costs** — User pays rent + fees; see priority-fee row above for congestion.

2. **Domain resolution** — Depends on [Metasal](https://api.metasal.xyz) availability. Only names ending in `.skr` are shown; all other cases keep truncated address.

### CI

Run `npm run ci` for TypeScript, lint, format, and Android prebuild.

### Environment Variables Required

```
EXPO_PUBLIC_PINATA_JWT=your_pinata_jwt
EXPO_PUBLIC_PINATA_GATEWAY=your_gateway.mypinata.cloud
EXPO_PUBLIC_SOLANA_RPC=https://api.mainnet-beta.solana.com
# Optional: Solscan links when RPC URL does not contain "devnet"
EXPO_PUBLIC_SOLANA_CLUSTER=mainnet
```

### Solana RPC (mint broadcast)

- **App-controlled send** — Mint uses `signTransaction` in the wallet, then submits the signed tx via `client.rpc` from `MobileWalletProvider` (`EXPO_PUBLIC_SOLANA_RPC` in [`_layout.tsx`](src/app/_layout.tsx)). The wallet's `signAndSend` path is avoided so broadcast does not depend on each user's wallet RPC settings (e.g. Seeker default).

### Pinata (IPFS uploads)

- **SDK** — The app uses the current unified npm package `pinata` (not deprecated `pinata-web3`). Initialization matches [Pinata's quickstart](https://docs.pinata.cloud/quickstart): `PinataSDK` with `pinataJwt` and `pinataGateway`; uploads use `pinata.upload.public.file(...)`. The SDK sends `Authorization: Bearer <JWT>` — do not use legacy `pinata_api_key` / secret headers or query params.

- **React Native uploads** — Image and metadata uploads use `{ uri, name, type }` parts (temp JSON under cache for metadata) instead of `new File(...)`, because Hermes/RN can expose `File.name` as a read-only getter and Pinata/FormData may throw when assigning to it.

- **JWT format** — Use the **long API JWT** from Pinata (starts with `eyJ`). Put it on **one** line: `EXPO_PUBLIC_PINATA_JWT=eyJ...`. Run `npm run check:pinata-env` to validate shape and length (never commit real JWTs).

- **Key permissions** — When creating the API key in Pinata, enable permissions that allow **file / content upload** for your account (labels vary by dashboard). A JWT without upload scope can produce **401/403** even if the token string looks valid.

- **Gateway** — Set `EXPO_PUBLIC_PINATA_GATEWAY` to your dedicated gateway host (e.g. `your-subdomain.mypinata.cloud`) without `https://`; the SDK normalizes it.

- **Validate JWT (no secret in logs)** — From the machine that has `.env` loaded:
  - `npm run test:pinata-auth` — calls Pinata's test endpoint and prints **HTTP status only**.

  - Or manually: `GET https://api.pinata.cloud/data/testAuthentication` with header `Authorization: Bearer <YOUR_JWT>`. Do not paste the JWT into chat or screenshots.

- **Security (mobile / `EXPO_PUBLIC_`)** — `EXPO_PUBLIC_PINATA_JWT` is **inlined into the client bundle** and can be extracted from the app binary. That is acceptable for **prototyping** if you accept leakage risk and rotate/revoke keys if needed. For **production**, prefer **short-lived signed upload JWTs from a backend** or **proxying uploads through your server** so the app never embeds a long-lived account JWT.

---

## Context Patterns

### Vision Camera Pattern

```typescript
import { Camera, useCameraDevice, useCameraPermission, PhotoFile } from 'react-native-vision-camera'

const { hasPermission, requestPermission } = useCameraPermission()
const device = useCameraDevice('back')
const cameraRef = useRef<Camera>(null)

// Capture
const photo: PhotoFile = await cameraRef.current.takePhoto({
  flash: supportsFlash ? flash : 'off',
  enableShutterSound: true,
})

// Focus (requires device.supportsFocus check)
await cameraRef.current.focus({ x: locationX, y: locationY })

// JSX
<Camera
  ref={cameraRef}
  style={StyleSheet.absoluteFill}
  device={device}
  isActive={true}
  photo={true}
  zoom={zoom}
/>
```

### Gesture Handling Pattern (Pinch-to-Zoom)

```typescript
import { Gesture, GestureDetector, GestureUpdateEvent, PinchGestureHandlerEventPayload } from 'react-native-gesture-handler'

const baseZoomRef = useRef(1)

const pinchGesture = Gesture.Pinch()
  .onStart(() => {
    baseZoomRef.current = zoom  // Capture current zoom at gesture start
  })
  .onUpdate((event: GestureUpdateEvent<PinchGestureHandlerEventPayload>) => {
    const newZoom = Math.min(Math.max(baseZoomRef.current * event.scale, minZoom), maxZoom)
    setZoom(newZoom)
  })
  .runOnJS(true)

// Must wrap app in GestureHandlerRootView (see _layout.tsx)
<GestureDetector gesture={pinchGesture}>
  <Pressable onPress={handleFocus}>
    {/* content */}
  </Pressable>
</GestureDetector>
```

### Uniwind (Tailwind) Styling Pattern

```typescript
// className prop with Tailwind classes
<View className="flex-1 bg-black items-center justify-center px-8">
<Text className="text-white text-xl text-center mb-4">
<Pressable className="bg-purple-600 px-4 py-2 rounded-full">

// Conditional classes
className={`w-12 h-12 rounded-full ${supportsFlash ? 'bg-black/50' : 'bg-black/30'}`}

// Combine with style prop for dynamic values
<View className="absolute top-12" style={{ opacity: isCapturing ? 0.5 : 1 }}>
```

### Expo File System Pattern (New API)

```typescript
import { Paths, File, Directory } from 'expo-file-system'

const photosDir = new Directory(Paths.document, 'photos')
if (!photosDir.exists) {
  photosDir.create()
}

const sourceFile = new File(`file://${photo.path}`)
const destFile = new File(photosDir, fileName)
sourceFile.move(destFile)

// Access URI
const uri = destFile.uri
```

### Domain Resolution Pattern (`.skr` only)

```typescript
import { useWalletDomain, formatWalletDisplay } from '../hooks/useWalletDomain'

const walletAddress = account?.address?.toString() ?? null
const { domain, isLoading } = useWalletDomain(walletAddress)

// Display: .skr domain if resolved; otherwise truncated address (unchanged)
const displayName = formatWalletDisplay(walletAddress, domain, 12)
```

---

## Remaining to-dos

**Mint / chain**

- [x] **Mainnet mint** on Seeker: end-to-end flow confirmed working (image + all metadata properties visible in wallet).
- [ ] **Devnet mint** (optional cheap regression): point `.env` to devnet RPC + mint on devnet; revert env for production builds.
- [ ] Implement **compute unit limit + priority fee** on the mint transaction (see Proposed improvements).

**Credentials / env**

- [ ] After any `.env` change: `npm run check:pinata-env`, `npm run test:pinata-auth`, `npx expo start --clear`.
- [ ] Rotate Helius API key (exposed in prior chat session).

**Wallet / domain QA**

- [ ] Connect a wallet with a **`.skr`** name; confirm header shows domain; wallet without `.skr` shows truncated address.

**Code hygiene**

- [ ] Clear **ESLint warnings** in `gallery.tsx` / `review.tsx` or document why they are intentionally deferred.

**Product (optional)**

- [ ] Camera timer / rule-of-thirds grid; consolidate gallery vs review if desired.
- [ ] Investigate **public IPFS gateway or Arweave** for broader explorer/marketplace image rendering (Solscan, Magic Eden, etc.).

---

_Last updated: March 25, 2026_
