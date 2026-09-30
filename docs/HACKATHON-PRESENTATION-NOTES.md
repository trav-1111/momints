# Momints — hackathon presentation notes

Running notes for the CLOCK IN pitch deck and three-minute demo. Add future presentation-worthy decisions, explanations, and evidence to this document as they arise. These are working notes, not a final presentation or a claim that release checks are complete.

## Image quality, storage cost, and hackathon scope

Recorded: 29 September 2026.

### Presentation blurb

Momints balances photographic quality with an accessible cost per photograph. For the hackathon, we are keeping the existing 3 MiB image allowance and pricing while focusing on reliable roll limits and a complete experience on Seeker. Before public release, we will review visual quality across representative photographs and evaluate whether a larger allowance meaningfully reduces compression. Any pricing changes will follow that evidence and actual storage costs.

### Supporting notes

- The current permanent-image ceiling is **3 MiB**, with a **2.9 MB** compression target. The proposed temporary 3.9 MiB increase was not adopted in this discussion.
- The file-size allowance controls storage and upload costs. Decoded image dimensions are a separate control on graphics memory.
- JPEG quality settings are encoder controls, not percentages of original image quality. Comparisons will happen during development; users will not need to judge compression samples.
- A full private-corpus Seeker test completed **58 matched A/B pairs / 116 native outputs** across House Color and Bali 400. Forced quality 60 reduced bytes by **65.15% overall** without resizing or failures. At ordinary viewing size the pairs were broadly alike, while 100% crops showed softer/blockier fine foliage and texture, stronger gradient banding, and reduced grain definition. Skin colour and highlight behavior remained stable in the reviewed cases. After reviewing that evidence, the owner approved quality 60 as the emergency floor on 30 September 2026; the normal quality ladder remains unchanged.
- Solana rent reductions lower on-chain account costs, but do not directly lower Arweave storage costs. Momints' automatic roll pricing already incorporates live rent, so those savings cannot also be treated as unused storage funding at the same current fee.
- Keep the hackathon scope focused: finish the roll caps and submission verification rather than reopen the image allowance and pricing now. This note does not certify the caps or release gates as complete.
- Larger images, less compression, and higher prices remain options for evaluation, not promised release changes.

### Evidence and references

- [Production checklist and recorded JPEG comparisons](ROLL-FRAME-PRODUCTION-CHECKLIST.md)
- [Current pricing model](../worker/README.md#cost-plus-fee-pricing)
- [Solana September 18 changelog: mainnet rent reduced to 5,080 lamports per byte](https://solana.com/news/solana-changelog-september-18-2026)

## Roll photograph limits

Recorded: 30 September 2026.

### Presentation blurb

Each new roll photograph uses the same storage allowance as a Quick Shot. Momints prepares and checks the image before accepting the exposure, then independently checks the uploaded image before minting. This keeps prepaid storage costs bounded across a complete roll.

### Policy and verification

- Keep the existing **3 MiB maximum per photograph**, with a **2,900,000-byte encoding target**. This is a per-image limit, not a shared roll budget.
- A 12-frame roll therefore allows at most **36 MiB of photograph data**, and a 24-frame roll **72 MiB**, excluding metadata and the collection cover.
- Keep the existing JPEG output and geometry limits: **12 megapixels**, with a maximum **4,000-pixel long edge**. Encoding can reduce quality or dimensions to fit; these are maximum dimensions, not a guarantee of unchanged resolution.
- If processing cannot produce a verified image within the limit, it must fail before the photograph is accepted or the roll exposure advances.
- Source inspection confirms these checks already exist in the local app and Worker changes. The focused image-artifact and Worker roll-contract suites passed **15 tests** on 30 September. Some integration assertions are source checks; these results do not replace real-device or deployed endpoint verification.
- The Worker retains a separate **8 MiB compatibility allowance for pre-contract rolls**. It is not the allowance for newly created rolls.
- No allowance, compression setting, or price was changed by this review. The owner subsequently accepted quality 60 as the emergency floor on 30 September after the full canonical comparison. Worker deployment, migrations and real paid-roll verification remain separate gates.

References: [app limits](../src/config/imageArtifact.ts), [capture checks](../src/app/camera.tsx), [Worker validation](../worker/src/rolls/imageArtifact.ts), and [production checklist](ROLL-FRAME-PRODUCTION-CHECKLIST.md).

## Adding future notes

Add a dated topic with a concise presentation blurb, supporting evidence, and any unresolved decisions. Distinguish demonstrated behaviour from plans, and revise superseded claims before using them in the final deck or demo.
