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
- The focused app and Worker contract suites passed, and the isolated staging Worker subsequently passed **65/65 deployed no-funds checks** covering authorization, byte/dimension rejection, receipts, cleanup, catalogue integrity and rate limiting. Real paid-roll verification remains separate.
- The Worker retains a separate **8 MiB compatibility allowance for pre-contract rolls**. It is not the allowance for newly created rolls.
- No allowance, compression setting, or price was changed by this review. The owner subsequently accepted quality 60 as the emergency floor on 30 September after the full canonical comparison. Isolated Worker staging and migrations now pass; real paid-roll verification remains a separate gate.

### Backend evidence

The current Worker code first ran in an isolated environment at `staging-api.momints.xyz`, where a synthetic no-funds suite passed 65/65 checks and returned staging D1/R2 state to empty. It was then promoted, without copying synthetic records, to `api.momints.xyz`. The existing production identity, treasury, database and storage were independently verified before the single production consumer/schedule set was activated. No verification step initiated a mainnet transaction, Arweave upload or notification.

References: [app limits](../src/config/imageArtifact.ts), [capture checks](../src/app/camera.tsx), [Worker validation](../worker/src/rolls/imageArtifact.ts), and [production checklist](ROLL-FRAME-PRODUCTION-CHECKLIST.md).

## Backend release preparation

Recorded: 30 September 2026. Status: production backend active; owner-led paid tests pending.

Presentation note: Momints first tested its backend changes in a separate environment, passing 65 no-funds operational checks. The tested service now answers on the app's own API domain with the existing production database, storage, payment history and signing identity preserved. Exactly one production Queue execution path and one intended schedule set are active.

The live inventory found no pending Quick work, queue backlog or unfinished handoff, but it did find one dormant pre-contract roll from 27 July with three minted frames. That record and all payment-signature history were preserved. The old service is inaccessible and detached. The production signer, mainnet RPC, treasury, balances, protected operator routes and Seeker catalogue were verified without spending funds. This activation does not establish funded end-to-end mint success; real Quick and 12/24-frame tests remain outstanding.

## Adding future notes

Add a dated topic with a concise presentation blurb, supporting evidence, and any unresolved decisions. Distinguish demonstrated behaviour from plans, and revise superseded claims before using them in the final deck or demo.
