# Momints

**Capture. Mint. Own.**

Momints is a mobile NFT camera app built for the Solana Seeker. Take photos, add metadata, and mint them as Metaplex Core NFTs — either one at a time ("quick shots") or as a prepaid 12/24-exposure roll, both backed by the [roll Worker](worker/README.md).

**Currently devnet only.** The Worker's RPC is wired to devnet; permanent storage writes genuine mainnet Arweave via Turbo regardless — see [worker/README.md](worker/README.md) for the backend and its fee-verification model.

## Features

- Full-screen camera with flash, tap-to-focus, pinch-to-zoom, and front/back toggle
- Photo sandbox — images stay in-app, never saved to your device gallery unless you choose to
- Rotation editor with fine-grained slider and 90-degree steps
- **Quick shots** — mint a single photo immediately; the storage fee rides in the same wallet signature as the mint
- **Rolls** — pay once up front for a 12 or 24-exposure roll; frames mint server-side (Worker-signed, no per-frame wallet approval) into a collection the shooter owns from creation
- Permanent storage on genuine Arweave via Turbo — not IPFS pinning
- On-chain royalties (5% to the shooter, no platform cut) and verified-creator signatures
- Wallet connection through Mobile Wallet Adapter (Phantom, Solflare, Seeker built-in, etc.)
- `.skr` domain resolution — wallet header shows your Solana domain if you have one

## Getting Started

### Prerequisites

- **Node.js 18+** (tested on 22.x)
- **Android Studio** with Android SDK installed — needed for `expo run:android`
- **A Solana Seeker** (or any Android device with a Solana wallet installed)
- **USB debugging enabled** on the device
- **The roll Worker deployed and reachable** — see [worker/README.md](worker/README.md). The app has no on-device fallback: minting requires `EXPO_PUBLIC_ROLL_API`.

### Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/momints.git
cd momints
npm install
```

### Environment variables

The app needs a `.env` file with the roll Worker URL, treasury address, and a Solana RPC endpoint. **Ask the project owner for the `.env` file** and place it in the project root. A template is provided for reference:

```bash
cp .env.example .env
# Then paste the real values you received
```

### Build and run on your Seeker

Connect your device via USB, make sure it shows up in `adb devices`, then:

```bash
npm run android
```

This runs `expo run:android`, which prebuilds the native project and installs the app directly onto your device via ADB. The first build takes several minutes; subsequent runs are faster.

> **Note:** The EAS cloud build (`eas build --profile preview`) is configured but untested. For now, use `npm run android` with a local Android SDK.

### Development server

If you already have the app installed and just want to iterate on JS changes:

```bash
npm run dev
```

This starts the Expo dev server with cache clearing. The app on your device will connect and hot-reload.

## Using the App

1. **Connect wallet** — tap the wallet icon on the camera screen
2. **Take photos** — use the shutter button; swipe through the review flow to keep, delete, or mark photos for minting
3. **Mint** — tap a queued photo to fill in its metadata (title, artist), or start a prepaid roll before shooting
4. **Confirm** — quick shots ask for one wallet signature (mint + fee together); roll frames mint server-side with no per-frame approval
5. **Verify** — the app shows a Solscan link after minting; your NFT also appears in your wallet's collectibles

Quick-mint and roll fees are priced from measured on-chain/storage cost, not placeholders — see the cost-basis comments in `src/config/roll.ts` and `worker/src/quick/config.ts`.

## Project Structure

```
src/
├── app/                    # Expo Router screens
│   ├── _layout.tsx         # Root layout with wallet provider
│   ├── index.tsx           # Splash / connect screen
│   ├── camera.tsx          # Camera capture
│   ├── gallery.tsx         # Photo grid
│   ├── review.tsx          # Post-capture review flow
│   └── mint/
│       ├── form/[id].tsx   # Metadata form
│       └── progress.tsx    # Mint queue + minting progress
├── components/             # Reusable UI components
├── hooks/                  # useMint, useCreateRoll, useWalletDomain, ...
├── services/                 # On-chain minting, roll/quick-mint API clients
└── store/                  # Zustand state (photos, mint queue, roll registry)

worker/                     # Cloudflare Worker backend — see worker/README.md
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Expo 54 + React Native |
| Camera | react-native-vision-camera |
| Styling | Tailwind CSS (Uniwind) |
| State | Zustand |
| Blockchain | Solana (devnet) |
| NFT | Metaplex Core |
| Storage | Genuine Arweave via Turbo (Worker-side) |
| Backend | Cloudflare Workers + D1 + R2 + Queues — see [worker/README.md](worker/README.md) |
| Wallet | Mobile Wallet Adapter (`@wallet-ui/react-native-kit`) |
| RPC | Configurable via `.env`; the Worker uses its own Helius devnet endpoint |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run android` | Build and install on connected Android device |
| `npm run dev` | Start Expo dev server (hot reload) |
| `npm run lint` | Lint and auto-fix |
| `npm run fmt` | Format with Prettier |
| `npm run ci` | TypeScript + lint + format check + Android prebuild |

## Known Limitations

- **Devnet only** — the Worker's RPC is devnet. Do not treat balances, fees, or minted assets as real value. **Storage is the exception:** Turbo has no devnet, so every mint — even in this devnet build — writes real bytes to genuine mainnet Arweave and spends real Turbo credits.
- **Client-side RPC key** — `EXPO_PUBLIC_SOLANA_RPC` is bundled into the app via `EXPO_PUBLIC_*`, which Expo inlines as plaintext at build time. Fine for a devnet key with a low blast radius; rotate before any wider distribution.
- **No on-device fallback** — if `EXPO_PUBLIC_ROLL_API` is unset or the Worker is unreachable, minting fails with a clear error rather than degrading to a different code path.

## License

MIT
