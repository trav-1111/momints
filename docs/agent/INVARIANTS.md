# Momints System Invariants & Non-Negotiable Rules

> **Audience:** All AI Agents & Developers working on Momints.  
> **Rule:** Every change MUST respect these invariants. Never weaken or bypass them without explicit human sign-off.

---

## 1. Git Remote & Repository Governance

* **Remote `zaacishere` (`https://github.com/ZaacIsHere/momints`):**
  * Zaac's sandbox and staging remote.
  * You MAY commit and push to branches on `zaacishere` (e.g. `fix/*`, `feature/*`, `v2-staging`).
* **Remote `origin` (`https://github.com/trav-1111/momints`):**
  * Trav's upstream production baseline.
  * **STRICT PROHIBITION:** AI AGENTS MUST NEVER PUSH TO `origin`.
  * All contributions for Trav must be prepared as review briefs or pull requests from `zaacishere`.

---

## 2. Cryptographic & Mobile Wallet Adapter (MWA) Invariants

### 2.1 Ed25519 Signature Slicing
* **The Reality:** Solana Mobile Wallet Adapter `signMessages` returns concatenated byte arrays `[message_bytes + signature_bytes]` (payload length > 64 bytes).
* **The Rule:** The Solana Ed25519 signature is strictly the **last 64 bytes**.
* **Implementation:** Always use [`extractSignatureBytes(signedPayload)`](file:///Users/zaac/momints/src/services/rollApi.ts#L269):
  ```typescript
  if (signedPayload.length < 64) throw new Error(...)
  return signedPayload.length === 64 ? signedPayload : signedPayload.subarray(signedPayload.length - 64)
  ```
* **Failure Consequence:** Sending un-sliced payloads causes backend verification to reject with HTTP 403 / "Signature verification failed".

### 2.2 Atomic Auth Token Migration
* **The Reality:** Older app builds stored unencrypted MWA auth tokens in `@react-native-async-storage/async-storage`. Modern builds store encrypted tokens in `expo-secure-store`.
* **The Rule:** Migration must follow strict write-before-delete ordering:
  1. Read legacy token from `AsyncStorage`.
  2. Write encrypted token to `SecureStore.setItemAsync`.
  3. **Only upon confirmed success** of step 2, call `AsyncStorage.removeItem`.
* **Failure Consequence:** Deleting the legacy token before writing causes catastrophic token loss if the secure write fails, forcing unexpected user re-authentication.

### 2.3 Recovery Capability Staging (Idempotency)
* **The Reality:** Legacy roll capability recovery (`POST /rolls/<collection>/authorize`) binds a device-held bearer token to a pre-contract roll. If the Worker commits authorization to D1 but the network drops before the client receives the HTTP 200 response, a retry will occur.
* **The Rule:** Always stage the generated capability (`stageRecoveryRollCapability`) **before** dispatching the request. On retry, always reuse the staged capability.
* **Failure Consequence:** If retries generate a new random capability, the Worker rejects with HTTP 409: *"This roll already has different authorization"*, permanently stranding the roll.

---

## 3. Financial & Backend Trust Invariants

### 3.1 Worker Fee Verification Precedes All Backend Spends
* **The Rule:** The backend Worker NEVER spends treasury funds, creates Metaplex Core collections, or allocates Arweave/Turbo storage without first verifying the on-chain fee payment on Solana RPC.
* **Client Implication:** The mobile client never calculates or dictates fee amounts; it fetches terms from the Worker (`/fees` or `/quick/stage` or `/skr/quote`) and provides the on-chain transaction signature to the Worker.

### 3.2 Single Open Roll per Wallet
* **The Rule:** The Worker enforces a strict database constraint: at most **one open roll** per wallet at any time.
* **Client Implication:** A user cannot create a new roll until the current open roll is either fully minted (`size === mintedCount`) or closed early via `POST /rolls/<collection>/complete`.

---

## 4. Hardware & Camera HAL Invariants (Solana Seeker)

* **Target Device:** Solana Seeker (`Seeker-DVT-Device-A` / `Seeker-DVT-Device-B`), Android 16 (API 36).
* **Sensor Letterbox Geometry:**
  * Sensor array is 4:3 (Rear 108MP). Display is ~20:9.
  * Any touch focus / exposure reticle coordinate must be transformed using contain-fit scaling and orientation offsets before submitting `MeteringRectangle` to Camera2.
* **Manual AE Lock:**
  * Seeker vendor HAL does not support decoupled AE modes. When adjusting ISO or shutter speed, `CONTROL_AE_MODE` MUST be set to `CONTROL_AE_MODE_OFF`.
* **Direct Boot & File-Based Encryption (FBE):**
  * Android 16 boots into `RUNNING_LOCKED` state. Until the user inputs their PIN/fingerprint, Credential-Encrypted (CE) storage is locked, and the OS will fail to resolve non-system launcher activities (`START_CLASS_NOT_FOUND` / -92). Do not confuse lockscreen state with missing APK components.

---

## 5. Domain Identity & Asset Links Invariants

* **Declared App Identity:** Declared in [`_layout.tsx`](file:///Users/zaac/momints/src/app/_layout.tsx) as `uri: 'https://momints.xyz'`.
* **MWA Resolution Host:** MWA wallets query `/.well-known/assetlinks.json` from the exact host declared in `identity.uri`.
* **The Rule:** Adding an assetlinks route to `api.momints.xyz` does NOT satisfy MWA verification if the app declares `https://momints.xyz`. The assetlinks file must be served by the web landing host (`momints.xyz`) with the production release certificate fingerprint.
