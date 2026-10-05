# Momints — Pitch Deck

## CLOCK IN: The Solana Mobile Hackathon (Solana Mobile × RadiantsDAO)

**Tagline:** Shoot. Mint. Yours.  
**Platform:** Built natively for Solana Seeker | Android (arm64-v8a)  
**Authors:** Zaac & Travis (@trav-1111)  
**Repository:** `https://github.com/trav-1111/momints`

---

## Slide 1: Title & The Hook

### Visual

- Minimalist, warm analog film aesthetic.
- Close-up photo of the physical Solana Seeker hardware in hand, showing the Momints camera viewfinder displaying the tactile shutter dial, focus reticle, and the `.skr` handle badge (`trav.skr`) in the top corner.
- Large typography: **Momints** — _Shoot. Mint. Yours._

### Copy / Voiceover Key Points

- Every day, billions of photos are taken on smartphones. 99.9% are disposable, forgotten in cloud feeds, scraped by AI platforms, or lost when subscriptions expire.
- Digital cameras made photography cheap, but stole its soul: the intentionality, the tangible craft, and true permanence.
- **Momints brings the craft and consequence of analog film to Web3, built from the metal up for Solana Seeker.**

---

## Slide 2: The Problem — The Disposable Photo Era

### Visual

- Contrast split screen:
  - Left: Infinite camera roll scroll of 25,000 blurry, meaningless screenshots and duplicate selfies.
  - Right: Web2 photo apps that lock high-res originals behind monthly cloud rents or compress them into ad-supported social algorithms where you own nothing.

### Key Points

1. **Zero Intentionality:** Infinite free digital storage destroyed the craft of making each frame count.
2. **Platform Dependency:** You don't own your photos; cloud giants rent your memories back to you in compressed silos.
3. **The Web3 Mobile Void:** Most mobile crypto apps are clumsy desktop browser ports. None treat the smartphone’s primary sensor—the camera lens—as a first-class decentralized creator instrument.

---

## Slide 3: The Solution — Momints

### Visual

- Product showcase showing the core user loop:
  `[ Load Film Stock ] -> [ Frame & Dial Shutter ] -> [ Advance the Roll ] -> [ Develop & Reveal ] -> [ Permanent Ownership ]`

### Key Points

- **Shoot with Deliberate Craft:** Choose your roll (12 or 24 frames) and film stock. Every press of the shutter button is deliberate.
- **Encrypted Sandbox:** Roll frames are held in an AES-encrypted local sandbox until the roll is fully exposed—no immediate dopamine-scrolling, bringing back the authentic anticipation of analog film development.
- **Instant Mint, True Ownership:** The moment the roll finishes, it develops on-device via custom GPU shaders, mints into a Metaplex Core collection owned by your wallet, and archives permanently to Arweave.

---

## Slide 4: Built for Seeker — Hardware-Native Mobile UX

### Visual

- Hardware UI callouts pointing directly to features on the Solana Seeker display:
  - Dual-ring tactile AF / AE decoupled lock reticles.
  - Spring-notched manual shutter dial (1/8000s to 16s).
  - VisionCamera orientation-responsive HUD.
  - Edge-aware EV sun slider.

### Key Points

- **Not a Web Wrapper:** Built with native Android C++ and Kotlin modules (`camera-caps`, `camera-manual`, `film-gl`).
- **Optimized for Seeker Silicon:** Engineered to run smoothly inside Seeker’s strict runtime envelope (<256 MiB Graphics, <1 GiB total PSS), returning memory directly to baseline after full 24-frame cycles.
- **Seed Vault & MWA First:** Seamless one-tap authentication and signing via Solana Mobile Stack (SMS).

---

## Slide 5: The LomoKino Revolution — Motion on Film

### Visual

- Visual breakdown of the newly integrated **LomoKino burst mode**:
  - Continuous motor-drive cadence selector: 3 FPS, 5 FPS, 8 FPS.
  - Synchronized rotary shutter blade blackout playback effect.
  - Contact-sheet film strip reel viewer.

### Key Points

- **Cinema in Your Pocket:** Inspired by the legendary Lomography 35mm hand-cranked movie camera.
- **Tactile Burst Capture:** Hold the shutter to crank through a sequence of sequential exposures across your roll.
- **Rotary Blade Playback:** On-device review replicates the physical shutter gate of early cinema projectors with custom shutter gap intervals (`subtle`, `classic`, `deep`).

---

## Slide 6: Native GPU Film Simulation (`film-gl`)

### Visual

- Shader pipeline diagram:
  ```text
  sRGB Normalization ➔ Tone Curves ➔ 33-point 3D LUT Atlas ➔ Halation & Bloom ➔ Procedural Seeded Grain ➔ Vignette ➔ sRGB Output
  ```
- Before/after slider comparing a raw sensor capture with **House Color** and **Bali 400** film stocks.

### Key Points

- **Authentic Optical Science:** No cheap Instagram overlays. We use calibrated 33-point 3D `.cube` color lookup tables and physical light diffusion models.
- **Photographic Halation & Bloom:** Physically models light scattering through film emulsion layers around high-contrast light sources.
- **Deterministic Procedural Grain:** Generated dynamically per frame based on local image luminance.

---

## Slide 7: Web3 Architecture — Fast, Permanent, Unstoppable

### Visual

- System Architecture Diagram:
  - **Client:** Seeker Device (Expo 54, React Native 0.81, Native GL, SMS MWA).
  - **Edge Backend:** Cloudflare Workers + D1 database at `api.momints.xyz`.
  - **Permanent Storage:** Arweave Turbo (prepaid, sub-second upload settlement, SHA-256 verified receipts).
  - **On-Chain State:** Metaplex Core on Solana Mainnet (single-account collections, low-rent, instant transfers).

### Key Points

- **Metaplex Core Collections:** Each completed roll is a canonical Core Collection; individual frames are Core Assets. Clean, lightweight, and composable across the Solana ecosystem.
- **Arweave via Turbo:** True permanent decentralized storage. Files are cryptographically bound to the on-chain metadata forever.
- **Zero Client Secret Exposure:** API keys and transaction signing delegates are isolated in Worker edge queues; client handles only user wallet signatures.

---

## Slide 8: SKR Integration — Identity & Mechanics ($10,000 Track)

### Visual

- Close-up of the camera HUD top-right corner displaying `trav.skr` and `zaac.skr` resolved live with green verified badge.
- Flowchart showing DAS reverse proof verification.

### Key Points

- **Live .skr Domain Resolution:** Seamlessly reverse-resolves connected wallet addresses to `.skr` handles directly in the camera viewfinder and mint receipts via cached Worker edge lookups.
- **On-Chain Film Stock Unlocks (DAS Proof):**
  - When a photographer shoots an authentic roll using a rotating film stock, the completed roll collection mints with an immutable cryptographic creator signature.
  - Future access to that film stock is verified directly on-chain via Digital Asset Standard (DAS) queries—no centralized entitlement databases!
- **SKR In-App Economy:** Direct foundation for future SKR token integration for limited-edition film stock drops and community curation.

---

## Slide 9: Unit Economics & Production Readiness

### Visual

- Transparent Cost Breakdown Table:

| Component                           | Cost per 12-Frame Roll | Cost per 24-Frame Roll |
| :---------------------------------- | :--------------------- | :--------------------- |
| **Metaplex Core Minting**           | ~0.0035 SOL            | ~0.0070 SOL            |
| **Arweave Turbo Permanent Storage** | ~0.0040 SOL            | ~0.0080 SOL            |
| **Worker / Infrastructure Fee**     | Nominal prepaid        | Nominal prepaid        |
| **Total Cost per Photo**            | **<$0.08 USD**         | **<$0.07 USD**         |

### Key Points

- **Mainnet Battle-Tested:** Not a devnet concept. Quick Shots, 12-frame, and 24-frame rolls have been successfully shot, developed, and minted on Solana Mainnet.
- **Strict Budget Envelope:** Verified 3 MiB / 2.9 MB per-image boundary prevents runaway storage costs while preserving gallery-grade resolution.
- **Clean Cryptographic Handoff:** Completed rolls revoke temporary Worker update delegates, ensuring 100% sovereign ownership belongs to the user.

---

## Slide 10: The Roadmap & The Team

### Visual

- Roadmap timeline leading into Solana dApp Store publication.
- Team bios: Zaac (Client Native Engineer & UX) & Travis (Infrastructure, Smart Contracts & Security).

### Roadmap

- **Q3 2026 (Completed):** Native `film-gl` engine, Seeker optimization, Metaplex Core + Arweave Turbo pipeline, LomoKino burst mode, `.skr` resolution.
- **Q4 2026:** Solana dApp Store official release, public Film Shelf drops, community darkroom curation, and physical gallery prints minted from Arweave receipts.
- **2027:** Peer-to-peer roll trades, open developer SDK for third-party film stock chemists.

### The Close

> _"Your camera shouldn't just capture data. It should create artifacts that outlast the device in your hand. Clock in with Momints."_
