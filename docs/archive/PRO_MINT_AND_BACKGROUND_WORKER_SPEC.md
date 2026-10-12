# Momints PRO MINT & Background Minting Architecture Specification

**Document Version:** 1.0.0  
**Target Platform:** Solana Seeker (Android 15 / API 35+, arm64-v8a)  
**Target Release:** Momints V2 / V3 Roadmap  
**Status:** Architecture Proposal & Implementation Specification  
**Authors:** Operator 2 (Momints Engineering Fleet)

---

## 1. Executive Summary & Problem Statement

Momints V1 established the baseline digital-analog photography loop on Solana Seeker: deliberate 12/24-frame roll commitments, on-device native OpenGL (`film-gl`) 3D LUT film simulation, local encrypted vaulting, and automatic Metaplex Core minting to Arweave Turbo.

However, two major technical frontiers remain to unlock the full commercial and artistic potential of the Solana Seeker platform:

1. **Loss of Native Optical Negatives (The Need for PRO MINT):**  
   Current mobile photography pipelines—including Momints V1—discard the sensor's raw 10-bit/12-bit Bayer Color Filter Array (CFA) data during demosaicing and sRGB normalization. Professional photographers, digital archivists, and high-value collectors demand the **digital negative**: the uncompressed, unadulterated sensor output. Providing an immutable `.RAW` DNG alongside the developed film `.JPG` creates a dual-asset digital artifact representing both the raw capture truth and the artistic development.
2. **Foreground-Locked User Experience (The Need for Background Minting):**  
   Minting an entire 12- or 24-frame roll requires asset compression, image verification, multi-file uploads to Arweave Turbo, and Solana blockchain transaction confirmations. Requiring the user to keep the app foregrounded with the screen active for 30–90 seconds creates friction, causes drop-offs when users switch apps, and risks Android OS Out-Of-Memory (OOM) process termination.

This document specifies the end-to-end technical architecture, Android native modules, cryptographic metadata standards, economic models, and background execution queues required to deliver **PRO MINT** and **Background Minting** on Solana Seeker.

---

## 2. Part 1: PRO MINT Architecture (.RAW DNG + Graded Film JPEG)

### 2.1 Optical & Sensor Pipeline (Android Camera2)

#### 2.1.1 Sensor & Stream Topology

The Solana Seeker hardware hosts an advanced high-resolution imaging sensor supporting raw sensor capture. To capture synchronous uncompressed RAW and processed JPEG streams without frame latency or visual parallax, the Android camera pipeline must bypass CameraX's simplified single-pipeline abstractions in favor of direct `android.hardware.camera2` multi-surface capture sessions.

```text
                               ┌─────────────────────────────────────────────────────────┐
                               │            Android Camera2 CaptureSession               │
                               └────────────────────────────┬────────────────────────────┘
                                                            │
                     ┌──────────────────────────────────────┼──────────────────────────────────────┐
                     ▼                                      ▼                                      ▼
        ┌─────────────────────────┐            ┌─────────────────────────┐            ┌─────────────────────────┐
        │  Surface 1: Viewfinder  │            │ Surface 2: Film Engine  │            │ Surface 3: Raw Master   │
        │     (SurfaceView)       │            │      (ImageReader)      │            │      (ImageReader)      │
        │  Format: PRIVATE / YUV  │            │    Format: YUV_420_888  │            │   Format: RAW_SENSOR    │
        │  Resolution: 1080p FHD  │            │ Resolution: 4000x3000   │            │ Resolution: Full Sensor │
        └─────────────────────────┘            └────────────┬────────────┘            └────────────┬────────────┘
                                                            │                                      │
                                                            ▼                                      ▼
                                               ┌─────────────────────────┐            ┌─────────────────────────┐
                                               │   OpenGL (film-gl)      │            │   DngCreator Pipeline   │
                                               │   3D LUT + Grain + H/B  │            │   Calibration Metadata  │
                                               └────────────┬────────────┘            └────────────┬────────────┘
                                                            │                                      │
                                                            ▼                                      ▼
                                               ┌─────────────────────────┐            ┌─────────────────────────┐
                                               │    Graded Film JPEG     │            │    Adobe DNG Master     │
                                               │       (2.9 MB)          │            │       (28.4 MB)         │
                                               └─────────────────────────┘            └─────────────────────────┘
```

#### 2.1.2 Camera2 Capture Configuration

1. **Target Format:** `android.graphics.ImageFormat#RAW_SENSOR` (10-bit or 12-bit linear Bayer CFA).
2. **Capability Verification:** Verify `CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES` includes `REQUEST_AVAILABLE_CAPABILITIES_RAW`.
3. **Capture Session Configuration:**
   - Configure three concurrent output surfaces:
     - Surface 1: Real-time UI viewfinder (`SurfaceView` or `SurfaceTexture`).
     - Surface 2: Image processing surface (`ImageReader`, `YUV_420_888`, max still resolution).
     - Surface 3: Raw capture surface (`ImageReader`, `RAW_SENSOR`, maximum physical sensor resolution).
4. **CaptureRequest Synchronization:**
   When the user triggers exposure, a single `CaptureRequest` is submitted targeting both Surface 2 and Surface 3 with identical manual parameters:
   - `CaptureRequest.SENSOR_SENSITIVITY`: Locked ISO (e.g. 100, 400).
   - `CaptureRequest.SENSOR_EXPOSURE_TIME`: Locked shutter speed (nanoseconds).
   - `CaptureRequest.LENS_FOCUS_DISTANCE`: Locked diopter focus value.
   - `CaptureRequest.COLOR_CORRECTION_MODE`: `TRANSFORM_MATRIX`.
   - `CaptureRequest.STATISTICS_LENS_SHADING_MAP_MODE`: `ON`.

#### 2.1.3 Adobe DNG Assembly via `android.hardware.camera2.DngCreator`

Writing a valid RAW file requires embedding sensor calibration, color matrices, and optical characteristics into standard TIFF-EP / Adobe DNG tags:

```kotlin
class RawDngWriter(
    private val characteristics: CameraCharacteristics,
    private val captureResult: TotalCaptureResult
) {
    fun writeDng(rawImage: Image, targetFile: File, orientation: Int) {
        DngCreator(characteristics, captureResult).use { dngCreator ->
            dngCreator.apply {
                setOrientation(orientation)
                setDescription("Momints Solana Seeker PRO Digital Negative")
                // Embed thumbnail preview extracted from YUV stream
                // Embed full camera characterization metadata
            }
            FileOutputStream(targetFile).use { outputStream ->
                dngCreator.writeImage(outputStream, rawImage)
            }
        }
    }
}
```

_Metadata Transferred into DNG Header:_

- **Color Matrices:** `COLOR_TRANSFORM_1`, `COLOR_TRANSFORM_2`, `FORWARD_MATRIX_1`, `FORWARD_MATRIX_2`.
- **Calibration Illuminants:** Typically Standard Light A (2856K) and D65 (6504K).
- **Lens Shading Maps & Distortion:** Geometric distortion parameters (`LENS_DISTORTION`) and radial shading coefficients.
- **White Level & Black Level:** `SENSOR_INFO_WHITE_LEVEL` and `SENSOR_BLACK_LEVEL_PATTERN`.
- **CFA Layout:** `SENSOR_INFO_COLOR_FILTER_ARRANGEMENT` (RGGB, BGGR, etc.).

#### 2.1.4 Native Bridge Architecture (`modules/camera-raw`)

To maintain modularity and avoid destabilizing the V1 baseline, the RAW engine is encapsulated in a dedicated Expo native module `modules/camera-raw`:

- `modules/camera-raw/android/src/main/java/expo/modules/cameraraw/CameraRawModule.kt`
- Exposes JavaScript methods:
  - `isRawSupported(): Promise<boolean>`
  - `setRawCaptureEnabled(enabled: boolean): Promise<void>`
  - `captureTwinFrame(options: RawCaptureOptions): Promise<TwinCaptureResult>`
- Return signature:
  ```typescript
  interface TwinCaptureResult {
    jpegUri: string
    jpegSha256: string
    rawUri: string
    rawSha256: string
    rawSizeBytes: number
    sensorMetadata: SensorExifProfile
  }
  ```

---

### 2.2 Storage & Memory Lifecycle Management

#### 2.2.1 File Sizing & Device Storage Quotas

- **Raw DNG Size:** ~24 MB – 36 MB per exposure (uncompressed 12-bit Bayer CFA at 12MP/50MP).
- **JPEG Size:** ~2.5 MB – 2.9 MB per exposure (curated filmstock render).
- **Twin-Frame Total:** ~27 MB – 39 MB per capture.
- **12-Frame Roll:** ~350 MB total local disk space.
- **24-Frame Roll:** ~700 MB total local disk space.

#### 2.2.2 Scoped Internal Storage Sandbox

RAW files contain pure personal capture data and must strictly obey Momints privacy guarantees:

1. RAW files are written directly into an isolated internal app sandbox:  
   `context.filesDir/raw_masters/<roll_id>/<frame_id>.dng`
2. **Preflight Storage Check:** Before starting a PRO roll, the app checks that free internal flash storage exceeds `(roll_size * 45 MB) + 500 MB safety buffer`. If insufficient, roll creation fails with an informative storage alert.
3. **Encrypted In-Flight Storage:** Unfinished PRO rolls encrypt both the RAW DNG and the JPEG using AES-256-GCM via `rollVault.ts` to prevent external access or unauthorized extraction.
4. **Lifecycle Disposal:**
   - **Upon Mint Confirmation:** The local RAW DNG is deleted from internal app storage once the Arweave Turbo receipt and Solana transaction are finalized and confirmed.
   - **Explicit User Export:** The user may tap "Export RAW Negative to Gallery" in the roll review screen, which copies the DNG to `MediaStore.Images.Media` with user permission before internal purge.

---

### 2.3 Metaplex Core Twin-Asset NFT Standard

#### 2.3.1 Canonical JSON Metadata Schema

Metaplex Core allows highly extensible off-chain JSON metadata linked via Arweave URIs. The PRO MINT standard establishes the JPEG as the primary visualization asset while declaring the `.RAW` DNG as the permanent cryptographic master file.

```json
{
  "name": "Momints PRO #0042 — Bali 400",
  "symbol": "MOMINT",
  "description": "Authenticated Solana Seeker camera exposure with graded filmstock and uncompressed raw digital negative.",
  "image": "https://arweave.net/k9Z_JPEG_TRANSACTION_ID_s89",
  "external_url": "https://momints.xyz/p/k9Z_JPEG_TRANSACTION_ID_s89",
  "properties": {
    "category": "image",
    "files": [
      {
        "uri": "https://arweave.net/k9Z_JPEG_TRANSACTION_ID_s89",
        "type": "image/jpeg",
        "role": "developed_print",
        "sha256": "4b92b67fbc908c697843d2629bfa5b7b13476ea99ff5a0678d91f24e93081e74",
        "fileSize": 2841920
      },
      {
        "uri": "https://arweave.net/m2X_RAW_DNG_TRANSACTION_ID_w11",
        "type": "image/x-adobe-dng",
        "role": "raw_master",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "fileSize": 29841280
      }
    ]
  },
  "attributes": [
    { "trait_type": "Asset Grade", "value": "PRO MINT (Twin-Asset)" },
    { "trait_type": "Film Stock", "value": "Bali 400" },
    { "trait_type": "Camera Hardware", "value": "Solana Seeker (SM02)" },
    { "trait_type": "Sensor Format", "value": "12-bit RAW_SENSOR" },
    { "trait_type": "CFA Pattern", "value": "RGGB" },
    { "trait_type": "Focal Length", "value": "24mm eq." },
    { "trait_type": "Aperture", "value": "f/1.8" },
    { "trait_type": "Shutter Speed", "value": "1/500s" },
    { "trait_type": "ISO", "value": "400" },
    { "trait_type": "White Balance", "value": "5500K" },
    { "trait_type": "Roll Type", "value": "Prepaid 12-Frame PRO" },
    { "trait_type": "Momints Engine", "value": "v2.0-native-gl" }
  ]
}
```

#### 2.3.2 Cryptographic Twin-Binding

To guarantee that the RAW negative and the developed JPEG can never be separated or disputed:

1. The **SHA-256 hash of the developed JPEG** is written into the DNG's XMP metadata field: `xmp:MomintsDevelopedJpegHash`.
2. The **SHA-256 hash of the RAW DNG** is embedded in the JPEG EXIF UserComment and the Core NFT on-chain attribute `Raw Master SHA-256`.
3. Both files are sealed under the Metaplex Core `ImmutableMetadata` plugin.

---

### 2.4 Permanent Storage Economics (Arweave Turbo & Irys)

#### 2.4.1 Storage Cost Modeling

Arweave Turbo allows fiat and SOL-denominated prepayment for data uploads settled onto Arweave.

- **Base Arweave Oracle Cost:** ~$2.50 to $4.50 USD per GiB permanent (equivalent to ~$0.003 USD / MB).
- **Turbo Bundler Overhead & Guarantee:** ~2.5× multiplier for sub-second upload settlement, indexing, and gateway replication.
- **Effective Storage Rate:** ~$0.010 USD per MB.

| Asset Type                 | Average Size | Permanent Storage Cost (USD) | SOL Equivalent (@ $150/SOL) |
| :------------------------- | :----------- | :--------------------------- | :-------------------------- |
| **Standard Film JPEG**     | 2.8 MB       | ~$0.028 USD                  | ~0.000187 SOL               |
| **PRO RAW DNG Negative**   | 28.5 MB      | ~$0.285 USD                  | ~0.001900 SOL               |
| **Metadata JSON**          | 0.05 MB      | ~$0.001 USD                  | ~0.000007 SOL               |
| **Total Twin-Asset Frame** | **31.35 MB** | **~$0.314 USD**              | **~0.002094 SOL**           |

#### 2.4.2 Pricing & Roll Tiers

- **12-Frame Standard Roll:** ~$1.20 USD storage + rent + fee.
- **12-Frame PRO MINT Roll:**
  - Raw Storage (12 × 31.35 MB ≈ 376 MB): ~$3.76 USD.
  - Metaplex Core Accounts & Rent: ~$0.15 USD.
  - Total Roll Cost Basis: ~$3.91 USD.
  - Suggested User Retail Price: **0.035 SOL (~$5.25 USD)** (transparently covering permanent decentralized archiving for 12 museum-grade digital negatives).

---

## 3. Part 2: Background Minting Architecture (Android WorkManager + Foreground Service)

### 3.1 Background Execution Model on Android 15

Android 15 applies strict power management, Doze states, and App Standby Buckets. Background network activity and CPU utilization are aggressively throttled unless executed within proper Android framework abstractions.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                 Mint Job Initiated                                      │
└───────────────────────────────────────────┬─────────────────────────────────────────────┘
                                            │
               Is app active / capture session ongoing?
               ├── YES ──► Launch Android Foreground Service (Immediate Notification)
               │           ├── Holds PARTIAL_WAKE_LOCK & Wi-Fi Lock
               │           └── Processes active queue at maximum throughput
               │
               └── NO / APP KILLED ──► Schedule Android WorkManager (Persistent Queue)
                           ├── Constrained: NetworkType.CONNECTED + BatteryNotLow
                           └── Resumes from exact SQLite checkpoint on connection
```

#### 3.1.1 Tier 1: Active Roll Finalization (`ForegroundService`)

- **Trigger:** When user captures the final frame of a roll (e.g. 12/12) and taps "Develop & Mint".
- **Mechanism:** Android `ForegroundService` with a sticky ongoing notification:
  - Notification Title: `Momints Darkroom — Developing Roll`
  - Notification Body: `Minting frame 4 of 12 (Bali 400)...`
  - Progress Bar: Determinate `[ ====>------ ] 33%`
- **Purpose:** Ensures the operating system does not kill the process or degrade network sockets while the user switches to Twitter or locks their screen for a few seconds.

#### 3.1.2 Tier 2: Resumable Offline Queue (`WorkManager`)

- **Trigger:** Network failure, cellular quota restrictions, or app backgrounding during long queues.
- **Mechanism:** Android Jetpack `WorkManager` utilizing `CoroutineWorker`:
  ```kotlin
  class MintRollWorker(
      context: Context,
      params: WorkerParameters
  ) : CoroutineWorker(context, params) {
      override suspend fun doWork(): Result {
          val rollId = inputData.getString("roll_id") ?: return Result.failure()
          return MintPipelineManager.processRollQueue(rollId, applicationContext)
      }
  }
  ```
- **Work Constraints:**

  ```kotlin
  val constraints = Constraints.Builder()
      .setRequiredNetworkType(NetworkType.CONNECTED)
      .setRequiresBatteryNotLow(true)
      .build()

  val mintWorkRequest = OneTimeWorkRequestBuilder<MintRollWorker>()
      .setConstraints(constraints)
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
      .addTag("momints_mint_$rollId")
      .build()
  ```

---

### 3.2 Offline-First State Machine & SQLite Persistence

#### 3.2.1 Database Schema (`mint_jobs`)

Persistent tracking is maintained in an internal SQLite database (`momints_minting.db`):

```sql
CREATE TABLE IF NOT EXISTS mint_jobs (
    id TEXT PRIMARY KEY NOT NULL,             -- Unique UUID for the mint job
    roll_id TEXT NOT NULL,                   -- Associated roll identifier
    frame_index INTEGER NOT NULL,            -- 0-based index within the roll
    is_pro_mint INTEGER NOT NULL DEFAULT 0,  -- 1 if PRO MINT (RAW+JPEG), 0 for Standard
    jpeg_path TEXT NOT NULL,                 -- Absolute internal path to JPEG
    raw_path TEXT,                           -- Absolute internal path to DNG (if PRO)
    metadata_json TEXT NOT NULL,             -- Staged Metaplex Core JSON metadata
    status TEXT NOT NULL,                    -- State enum (see below)
    jpeg_tx_hash TEXT,                       -- Arweave transaction ID for JPEG
    raw_tx_hash TEXT,                        -- Arweave transaction ID for DNG
    metadata_tx_hash TEXT,                   -- Arweave transaction ID for Metadata
    solana_asset_id TEXT,                    -- Metaplex Core Asset public key
    retry_count INTEGER NOT NULL DEFAULT 0,  -- Number of retry attempts
    error_message TEXT,                      -- Detailed error log if failed
    created_at INTEGER NOT NULL,             -- Epoch milliseconds
    updated_at INTEGER NOT NULL              -- Epoch milliseconds
);

CREATE INDEX IF NOT EXISTS idx_mint_jobs_roll ON mint_jobs(roll_id, status);
```

#### 3.2.2 State Transitions & Fault Recovery

The state machine advances strictly forward through atomic transitions:

```text
 [ QUEUED ]
     │
     ▼
 [ VALIDATING_LOCAL_FILES ] ──► (Invalid/Missing) ──► [ PERMANENT_FAILURE ]
     │
     ▼
 [ UPLOADING_JPEG ] ──────────► (Network/Timeout) ──► [ RETRY_SCHEDULED ]
     │
     ▼
 [ UPLOADING_RAW ] (PRO only) ─► (Network/Timeout) ──► [ RETRY_SCHEDULED ]
     │
     ▼
 [ UPLOADING_METADATA ] ──────► (Gateway Error) ────► [ RETRY_SCHEDULED ]
     │
     ▼
 [ SUBMITTING_SOLANA_TX ] ────► (RPC Dropped) ──────► [ RETRY_TX_POLL ]
     │
     ▼
 [ CONFIRMED_ON_CHAIN ]
     │
     ▼
 [ PURGING_LOCAL_RAW ]
     │
     ▼
 [ COMPLETED ]
```

- **Idempotency Strategy:**
  - Before initiating an Arweave upload, the worker checks if `jpeg_tx_hash` is already populated.
  - Before submitting the Solana mint transaction, the worker queries the Worker relayer with the roll's deterministic signature to prevent duplicate minting.
- **Exponential Backoff:**  
  Initial retry after 15 seconds, doubling on subsequent failures (30s, 60s, 120s) up to a maximum cap of 1 hour. Transient network errors never cause job cancellation.

---

### 3.3 Solana Mobile Wallet Adapter (MWA) Authorization Strategy

#### 3.3.1 The Background Constraint Problem

On Android, security rules strictly forbid background tasks or services from launching interactive UI activities without explicit user initiation. Furthermore, **Seed Vault** on the Solana Seeker mandates biometric confirmation (fingerprint or PIN) to release cryptographic signatures.

Therefore, **a background service cannot prompt the user for signatures while running in the background.**

#### 3.3.2 Architectural Evaluation of Authorization Models

| Dimension              | Strategy A: Client Batch Pre-Signing                                                                  | Strategy B: Ephemeral Worker Delegation (Recommended)                                      |
| :--------------------- | :---------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| **Mechanism**          | User signs all 12/24 mint transactions upfront via MWA in one interactive session.                    | User signs 1 transaction delegating minting rights to Momints Worker scoped keypair.       |
| **Seed Vault Prompts** | 1 MWA batch signature sheet (signing 12–24 transactions at once).                                     | 1 standard MWA signature sheet (signing 1 delegation transaction).                         |
| **Arweave TX Timing**  | **High Failure Risk:** Arweave URIs must be known _before_ signing. If upload fails, txs are invalid. | **Robust:** Worker uploads assets first, then mints with exact confirmed Arweave URIs.     |
| **User Drop-Off Risk** | High: User must wait for pre-upload or pre-computation before signing.                                | Very Low: User signs immediately upon clicking "Develop Roll" and can close app instantly. |
| **Custodial Risk**     | Zero (User signs all exact mint transactions).                                                        | Zero (Worker is granted only a scoped `AddAsset` delegate to the user's collection).       |

#### 3.3.3 Recommended Architecture: Scoped Collection Delegate Pattern

Momints adopts the **Scoped Collection Delegate Pattern** natively supported by Metaplex Core:

```text
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │ 1. USER INITIATES (In-App, Interactive MWA)                                            │
 │                                                                                        │
 │ User signs 1 Solana transaction:                                                       │
 │ - Creates Metaplex Core Collection account (Owned 100% by user wallet).                │
 │ - Attaches Metaplex Core Plugin: `AddAssetDelegate` pointing to Momints Worker Signer.  │
 │ - Pays prepaid roll fee to Treasury.                                                   │
 └───────────────────────────────────────┬────────────────────────────────────────────────┘
                                         │
                                         ▼
 ┌────────────────────────────────────────────────────────────────────────────────────────┐
 │ 2. BACKGROUND WORKER EXECUTES (Autonomous & Offline)                                   │
 │                                                                                        │
 │ - WorkManager / Cloudflare Worker uploads JPEGs, RAW DNGs, and JSON metadata.          │
 │ - For each frame: Worker submits `CreateAsset` instruction using its Delegate Key:     │
 │     * Owner = User's Solana Wallet (100% self-sovereign).                             │
 │     * Collection = User's Collection Account.                                          │
 │     * Signer = Worker Delegate.                                                        │
 │ - After frame 12/12 confirmed: Worker submits `RevokeDelegate` transaction.            │
 └────────────────────────────────────────────────────────────────────────────────────────┘
```

_Security Guarantees:_

1. **Self-Sovereignty:** The user's wallet is established as the sole permanent owner of the Collection and all Assets from the moment of instruction execution.
2. **Zero Custody:** The Worker key has no authority to transfer, burn, or mutate assets; it only possesses permission to append up to `roll.size` assets to that specific collection.
3. **Automatic Expiration / Revocation:** The delegate authority is automatically revoked upon completion of the final frame, returning the collection to an immutable state.

---

## 4. Part 3: Implementation Roadmap & Migration Plan

```text
2026 Q4 (V1 Baseline)     2027 Q1 (V2 PRO MINT)          2027 Q2 (V3 Background Engine)
       │                            │                                  │
       ▼                            ▼                                  ▼
[ V1 Hackathon Final ] ──► [ modules/camera-raw ] ─────► [ modules/mint-worker ]
  • Native film-gl           • Camera2 RAW_SENSOR          • Android WorkManager
  • 4-Stock Catalog          • DngCreator Pipeline         • ForegroundService
  • .skr Resolution          • Metaplex Core Twin Spec     • Scoped MWA Delegate
```

### Phase 1: Native Camera2 RAW Engine (`modules/camera-raw`)

- Scaffold `modules/camera-raw` using the Expo Native Module API.
- Implement Camera2 multi-surface capture session configuration in Kotlin.
- Implement `DngCreator` metadata binding and file output to internal storage.
- Write standalone native unit tests validating DNG byte headers against the Adobe DNG 1.6 spec.

### Phase 2: Twin-Asset Metadata & Turbo Chunking Pipeline

- Extend `src/services/rollVault.ts` to manage paired `.jpg` and `.dng` file descriptors.
- Implement parallel chunked uploads for large ~30MB binaries using Arweave Turbo SDK.
- Integrate dual-hash verification (`jpegSha256` + `rawSha256`) in Worker ingest contracts.

### Phase 3: Android WorkManager & Offline SQLite State Machine

- Implement Android `ForegroundService` with notification progress management.
- Implement `WorkManager` `CoroutineWorker` queue bound to `NetworkType.CONNECTED`.
- Implement local SQLite table `mint_jobs` with automated retry state machine.
- Validate background execution under simulated process termination via ADB:  
  `adb shell am kill com.momints.app`

### Phase 4: Metaplex Core Scoped Delegate Integration

- Update Worker smart contract instructions to utilize `AddAssetDelegate` and `RevokeDelegate`.
- Validate complete 12- and 24-frame PRO roll mints end-to-end on Solana Mainnet.

---

## 5. Security, Memory & Privacy Audit Checklist

Before releasing PRO MINT or Background Minting to production, the implementation must satisfy all safety gates:

1. **Memory Budget Under RAW Decoding:**
   - Handling 30MB+ uncompressed image buffers must occur strictly in native memory (C++/Kotlin byte buffers).
   - No raw image byte arrays may be bridged to JavaScript/Hermes heaps to avoid triggering garbage collection thrashing or exceeding the Seeker 1 GiB PSS memory ceiling.
2. **Zero Residue Privacy Guarantee:**
   - Temporary unencrypted raw frames must be held exclusively in private internal app storage (`context.filesDir`).
   - When a roll is completed or discarded, all raw master files must be zero-overwritten or unlinked immediately.
3. **MWA Key Isolation:**
   - The client must never store or request persistent private key material. All delegated minting must occur via on-chain contract roles.
4. **Network Bandwidth Protection:**
   - WorkManager constraints must allow users to specify "Wi-Fi Only" for uploading large RAW digital negatives to protect user cellular data budgets.
