# Momints

**Capture. Mint. Own.**

Momints is a mobile NFT camera app built for the Solana Seeker. Take photos, add metadata, and mint them as NFTs directly on Solana mainnet — all from your phone.

## Features

- Full-screen camera with flash, tap-to-focus, pinch-to-zoom, and front/back toggle
- Photo sandbox — images stay in-app, never saved to your device gallery unless you choose to
- Rotation editor with fine-grained slider and 90-degree steps
- NFT minting with custom title, artist, description, and EXIF-like properties (device, capture date)
- IPFS storage via Pinata (image + metadata JSON)
- Wallet connection through Mobile Wallet Adapter (Phantom, Solflare, Seeker built-in, etc.)
- `.skr` domain resolution — wallet header shows your Solana domain if you have one

## Getting Started

### Prerequisites

- **Node.js 18+** (tested on 22.x)
- **Android Studio** with Android SDK installed — needed for `expo run:android`
- **A Solana Seeker** (or any Android device with a Solana wallet installed)
- **USB debugging enabled** on the device

### Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/momints.git
cd momints
npm install
```

### Environment variables

The app needs a `.env` file with Pinata and Solana RPC credentials. **Ask the project owner for the `.env` file** and place it in the project root. A template is provided for reference:

```bash
cp .env.example .env
# Then paste the real values you received
```

The keys are free-tier (Pinata and Helius) with limited usage, so please don't abuse them.

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
3. **Mint** — select a photo, fill in the metadata form (title, artist), and confirm the transaction in your wallet
4. **Verify** — the app shows a Solscan link after minting; your NFT also appears in your wallet's collectibles

Each mint costs approximately **~0.01 SOL** (rent + transaction fees).

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
│       └── progress.tsx    # Minting progress
├── components/             # Reusable UI components
├── hooks/                  # useMint, useWalletDomain
├── services/               # IPFS upload, on-chain minting
└── store/                  # Zustand state (photos, mint queue)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Expo 54 + React Native |
| Camera | react-native-vision-camera |
| Styling | Tailwind CSS (Uniwind) |
| State | Zustand |
| Blockchain | Solana mainnet |
| NFT | Metaplex Token Metadata |
| Storage | IPFS via Pinata SDK |
| Wallet | Mobile Wallet Adapter (`@wallet-ui/react-native-kit`) |
| RPC | Helius (configurable via `.env`) |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run android` | Build and install on connected Android device |
| `npm run dev` | Start Expo dev server (hot reload) |
| `npm run lint` | Lint and auto-fix |
| `npm run fmt` | Format with Prettier |
| `npm run ci` | TypeScript + lint + format check + Android prebuild |
| `npm run check:pinata-env` | Validate `.env` Pinata config shape |
| `npm run test:pinata-auth` | Test Pinata JWT authentication |

## Known Limitations

- **Free-tier keys** — Pinata and Helius keys have rate limits. Don't spam mints.
- **No priority fees** — Mint transactions don't include compute budget instructions yet, so they may fail during high network congestion.
- **Client-side secrets** — API keys are bundled into the app via `EXPO_PUBLIC_*`. Acceptable for testing, not for production.
- **IPFS gateway** — NFT images use `ipfs://` URIs which wallets resolve natively. Some block explorers (Solscan) may not render them inline.

## License

MIT
