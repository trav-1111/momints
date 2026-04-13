# Momints

**Capture. Mint. Own.**

Momints is a mobile-first NFT camera app for the Solana Seeker phone. Take photos, edit them, and mint them directly as NFTs on the Solana blockchain.

## Features

- **Camera Integration**: Full-screen camera with flash toggle and camera flip
- **Photo Sandbox**: Photos are stored in-app only, not in your device gallery
- **Simple Editing**: Rotate photos before minting
- **NFT Minting**: Mint photos as Metaplex NFTs with custom metadata
- **IPFS Storage**: Images and metadata stored on IPFS via Pinata
- **Wallet Integration**: Connect with any Solana mobile wallet

## User Flow

1. **Connect Wallet** - Link your Solana wallet
2. **Take Photos** - Capture images with the in-app camera
3. **Review & Edit** - View your photos, rotate as needed
4. **Mark Actions** - Choose to Delete, Save, or Mint each photo
5. **Add Metadata** - Enter title and artist name for each NFT
6. **Mint** - Upload to IPFS and mint on Solana mainnet
7. **Verify** - Check your NFTs on Solscan

## Tech Stack

- **Framework**: Expo + React Native
- **Camera**: react-native-vision-camera
- **Styling**: Tailwind CSS (Uniwind)
- **State**: Zustand
- **Blockchain**: Solana (mainnet)
- **NFT Standard**: Metaplex Token Metadata
- **Storage**: IPFS (Pinata)
- **Wallet**: Mobile Wallet Adapter

## Setup

### Prerequisites

- Node.js 18+
- Android Studio (for Android development)
- Solana mobile wallet (Phantom, Solflare, etc.)

### Installation

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env
```

### Environment Variables

Edit `.env` with your configuration:

```env
# Pinata IPFS (get from https://app.pinata.cloud)
EXPO_PUBLIC_PINATA_JWT=your_jwt_here
EXPO_PUBLIC_PINATA_GATEWAY=gateway.pinata.cloud

# Solana RPC (use dedicated RPC for production)
EXPO_PUBLIC_SOLANA_RPC=https://api.mainnet-beta.solana.com
```

### Development

```bash
# Start development server
npm run dev

# Build for Android
npm run android
```

## Project Structure

```
src/
├── app/                    # Expo Router screens
│   ├── _layout.tsx        # Root layout with wallet provider
│   ├── index.tsx          # Splash screen
│   ├── camera.tsx         # Camera capture
│   ├── gallery.tsx        # Photo review grid
│   ├── editor/[id].tsx    # Photo editor
│   └── mint/
│       ├── _layout.tsx    # Mint flow layout
│       ├── form/[id].tsx  # Metadata form
│       └── progress.tsx   # Minting progress
├── components/            # Reusable UI components
├── hooks/                 # Custom React hooks
├── services/              # IPFS and minting services
└── store/                 # Zustand state stores
```

## Minting Costs

Each NFT mint costs approximately **~0.01 SOL**, which includes:
- IPFS upload (via Pinata)
- On-chain NFT creation
- Transaction fees

## License

MIT
