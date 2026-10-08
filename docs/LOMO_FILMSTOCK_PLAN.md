# Momints Lomo filmstocks — research and development plan

> Superseded for access and backend architecture by [`FILMSTOCKS.md`](FILMSTOCKS.md). In particular, there is no film purchase or D1 entitlement table; developed-roll evidence is reconstructed through DAS.

Prepared 12 September 2026. Historical planning document; do not use its entitlement model for implementation.

## 1. Product decisions

Confirmed by Travis:

- A filmstock bought with SKR is permanently unlocked for that wallet and can be used on future rolls.
- Normal roll fees still apply. Buying a stock and paying for a roll are separate purchases.
- Everyone receives the same first filmstock free.

Recommended launch scope:

- Lomo rolls only: one free original Momints stock and two paid stocks with clearly different looks.
- Keep the existing basic Colour and B&W choices available without a stock purchase. Treat the new free starter as an additional, more expressive look.
- Choose the stock before loading a roll; its recipe stays fixed for every frame.
- Film purchases belong to a wallet. Recipes and verified access are saved on the phone for offline shooting.
- A limited release can close to new purchases while remaining usable and downloadable by people who already bought it.
- Preserve the current full-roll shooting and reveal flow. This feature does not add a photo editor or change when captured frames become visible.

The launch stock names, artwork, prices, release schedule and live-preview fallback remain product choices. Working names below are proposals.

## 2. What the app already has

The working tree was inspected, including ongoing camera changes. Recheck these integration points when implementation starts.

| Area           | Current implementation                                                                                                                                                                                                             | Required extension                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Image effects  | [filmProcessor.ts](D:/Claude/momints/src/services/filmProcessor.ts) passes colour through and applies a grayscale matrix to B&W.                                                                                                   | A shared, versioned renderer for stock recipes.                                                              |
| Capture        | [camera.tsx](D:/Claude/momints/src/app/camera.tsx) captures a photo, moves it into app storage, crops it and applies B&W.                                                                                                          | Process all selected stocks, retain recoverable inputs and distinguish pending renders from finished frames. |
| Roll selection | [mode-select.tsx](D:/Claude/momints/src/app/mode-select.tsx) has Colour/B&W pills.                                                                                                                                                 | Browse, preview, buy and load filmstocks.                                                                    |
| Session        | [session.ts](D:/Claude/momints/src/store/session.ts) saves film mode and aspect in an active roll.                                                                                                                                 | Persist stock ID, recipe version/hash, renderer version and owning wallet/cluster.                           |
| Photos         | [photos.ts](D:/Claude/momints/src/store/photos.ts) saves local photo records and roll membership.                                                                                                                                  | Add render state, seed, recipe reference, final-file hash and recovery information.                          |
| Payments       | [skrApi.ts](D:/Claude/momints/src/services/skrApi.ts), [rollCollection.ts](D:/Claude/momints/src/services/rollCollection.ts) and [worker SKR verification](D:/Claude/momints/worker/src/skr/verify.ts) support SKR roll/mint fees. | A distinct filmstock order and permanent entitlement, with purchase recovery.                                |
| Backend        | [roll creation](D:/Claude/momints/worker/src/rolls/create.ts), [frame minting](D:/Claude/momints/worker/src/rolls/frames.ts) and [D1 access](D:/Claude/momints/worker/src/db/index.ts) manage prepaid rolls.                       | Store the chosen stock on the server and derive film metadata from that record.                              |

Important findings:

- A colour stock would currently be skipped by the camera's `film.mode !== 'color'` condition.
- Existing parsing only retains `mode`; simply adding a stock field without changing hydration will lose it after restart.
- Crop and B&W processing delete their input files on success and silently return an unprocessed input on failure. Paid stocks need explicit render success/failure.
- Film selection is currently local; the roll creation request does not send it to the Worker.
- The active-session store is not wallet-scoped. The roll registry does record a wallet, which can help migrate existing sessions.
- Current prepaid creation supports 12 and 24 frames. A legacy local type also allows 36; this feature should not accidentally introduce a new paid roll size.

Installed stack: Expo 54, React Native 0.81.5, VisionCamera declared as ^4.7.3, React Native Skia 2.2.12, Reanimated 4.1.1 and react-native-worklets 0.5.1. Use the lockfile and installed APIs during implementation.

## 3. How to create a convincing film style

Use a combination of a colour response and spatial effects. A lookup table, or LUT, maps input colours to output colours; it is useful for a stock's colour character. Grain and light spreading need separate image operations.

| Ingredient            | What the user notices                                            | Proposed implementation                                                                                  |
| --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Tone response         | Softer bright areas, characteristic contrast and shadow depth.   | Smooth master and channel curves with controlled shadow and highlight behaviour.                         |
| Colour response       | Warm skin, muted greens, cooler shadows or selective saturation. | Curves/channel mixing initially; optional 3D LUT for more complex colour relationships.                  |
| Grain                 | Fine organic texture that changes with image brightness.         | Seeded, multiscale noise with a stock-specific luminance response; mostly shared across colour channels. |
| Halation              | A restrained warm fringe around intense lights and bright edges. | A highlight mask, blurred spatially and tinted, with bounded strength.                                   |
| Bloom                 | A softer, broader glow around bright areas.                      | A separate low-strength highlight blur. Keep it distinguishable from halation.                           |
| Vignette and softness | Gentle edge falloff and less clinical sharpness.                 | Small spatial adjustments, specified separately from the colour recipe.                                  |

Vignetting, leaks and optical softness are camera/lens or handling characteristics as well as aesthetic choices. They need not be added to every stock. Keep dust, scratches and random light leaks out of the starter stock.

Research basis:

- Kodak's Portra data sheet provides characteristic curves, spectral response and grain information. These are useful references for what a stock does, but they are not a ready-made phone filter. A film negative's density curves also do not directly describe a finished scan. [Kodak Portra 400 technical data](https://imaging.kodakalaris.com/sites/default/files/files/resources/e4050_portra_400.pdf)
- Film grain has a physical, spatial structure. Newson and colleagues provide a resolution-independent simulation; for this release, use the research as a quality reference and develop a lighter mobile approximation. Their published reference implementation is GPL-3.0-or-later, so it should not be copied into the app without a deliberate license decision. [Realistic Film Grain Rendering](https://www.ipol.im/pub/art/2017/192/)
- Kodak describes halation as light reflecting back into the emulsion and producing secondary exposure around bright objects. That supports a highlight-driven effect rather than a red overlay on the whole photograph. [Kodak filmmaking reference guide](https://www.kodak.com/content/products-brochures/Film/kodak-essential-reference-guide-for-filmmakers.pdf)
- OpenColorIO documents colour matrices, RGB curves, hue curves and LUT transforms. It is a useful authoring/reference tool; it does not need to ship inside the Android app. [OpenColorIO transforms](https://opencolorio.readthedocs.io/en/latest/guides/authoring/transforms.html)

These recommendations are an artistic approximation for processed phone photographs. They do not reproduce a film's chemistry, restore clipped detail or recreate its full response to the original scene spectrum.

### Suggested first collection

| Working name        | Access               | Creative brief                                                                                              | Best demonstration                                               |
| ------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Momints Everyday    | Free to everyone     | Warm-neutral colour, gentle highlights, fine grain, restrained saturation and very little glow.             | People, daylight, travel and everyday scenes.                    |
| Momints After Hours | Permanent SKR unlock | Cooler shadow colour, controlled warm halation around practical lights, stronger grain and richer contrast. | Neon, shop windows, evening portraits and street lights.         |
| Momints Sunfade     | Permanent SKR unlock | Warm highlights, softer contrast, faded greens/blues and a gentle edge falloff.                             | Beach, late afternoon, summer street scenes and flash snapshots. |

Use original Momints names and recipes. Avoid promising an exact Kodak, Fujifilm or CineStill match without a calibrated comparison process.

### Recipe authoring workflow

1. Assemble 24–40 owned or licensed test photos, preferably captured on Seeker and a second Android phone. Include varied skin tones, foliage, blue sky, saturated objects, fine texture, flat walls, gradients, night lights and flash.
2. Capture a smaller controlled set at normal exposure and real camera exposure compensation of roughly -1 and +1 EV. Include a neutral grey target and a colour chart if available.
3. Build an internal recipe workbench that renders the same inputs with adjustable tone, colour and texture parameters. Reuse the production Skia renderer so approved previews correspond to shipped output.
4. Tune colour and tone first, then add grain and light effects. Judge each effect on difficult scenes, not just its best sample.
5. If curves are insufficient, author a colour-only LUT. Start by testing a 33-cube LUT against a smaller 17-cube version; the choice is an image-quality/performance experiment, not a fixed requirement.
6. Record the LUT's input/output colour spaces, domain and interpolation. Never apply a log-camera LUT directly to an ordinary phone JPEG.
7. Generate each store sample using the production renderer. Include at least daylight, a face and a night scene for every stock.
8. Freeze an approved recipe version and its content hash. A later visual revision gets a new version; existing rolls retain the old one.

Texture scaling must be defined relative to the image/virtual film area, not UI density. Grain should still look appropriate in a small preview and a full-size export.

## 4. How the film behaves while shooting

### Loading

The user browses samples, chooses a stock, purchases it if necessary, and loads it into a new roll. Before taking the normal roll fee, confirm access, app compatibility and that the complete recipe is available on the device.

Store one immutable recipe reference on the roll. Changing stock requires the next roll. Do not offer a strength slider per shot for launch; the appeal is choosing a stock and committing to its character.

### In the viewfinder

Recommended experience: show the stock's colour and tone while composing. Preview grain and glow can be lighter or lower resolution to keep the camera responsive.

VisionCamera v4 Skia frame processors affect the preview; they do not bake their drawing into saved photos. The full captured photo must pass through a separate export renderer. Both paths should consume the same recipe and common shader functions. [VisionCamera v4.7.3 Skia guide](https://raw.githubusercontent.com/mrousavy/react-native-vision-camera/v4.7.3/docs/docs/guides/FRAME_PROCESSORS_SKIA.mdx)

Live preview remains a compatibility spike. The installed v4 integration imports `react-native-worklets-core`; the app lists `react-native-worklets`, which is a different package. Current online VisionCamera documentation describes a newer API. Do not copy that integration or upgrade the camera stack without testing this app's versions.

If live rendering is unstable or expensive, a viable reduced first release is an ordinary viewfinder, clear stock label and accurate sample previews before loading. Treat that as an explicit scope choice after measurement.

### At the shutter

The light in the captured image drives the effects:

- Intense lamps create more halation than an evenly lit wall.
- Dark and middle tones can have different grain strength from highlights.
- A fixed colour response produces different results under daylight, flash and mixed light.
- Grain receives a unique seed per frame and keeps that seed through retries. It never changes because the user reopens the gallery.

Keep normal camera exposure and autofocus behaviour for launch. A stock name containing “400” or “800” must not silently set the phone sensor ISO. Sensor exposure settings and an emulated film character are separate controls.

Phone JPEGs already contain automatic white balance and tone processing. A cool “tungsten-inspired” grade is possible; an authentic fixed film white-balance response is not guaranteed from those JPEGs. True fixed white balance or manual sensor controls belong in a later capture-control integration.

VisionCamera's installed PhotoFile type marks its metadata object as iOS-only. Do not assume Android ISO, shutter speed or colour temperature will arrive through that field. The launch renderer should work from image content; use a separately verified Android metadata path if sensor values are needed later.

### After capture and at reveal

Render the final image once after capture, while preserving the current hidden-frame/full-roll flow. “Developing” can remain the existing reveal ritual; the app does not need to defer expensive processing until every frame has been shot.

The saved, shared and minted photograph must use the same final rendered file. Contact sheets should use that file too. A mint retry must not render a different grain pattern or apply a newer recipe.

## 5. Rendering architecture and failure recovery

Recommended processing contract:

```text
camera photo
    → persist source + capture record
    → normalise orientation and colour interpretation
    → crop to the roll's aspect
    → highlight effects + stock colour/tone response
    → grain + approved spatial finishing
    → encode final JPEG
    → verify file and commit READY state
    → reveal / save / share / mint
```

The precise pass order becomes part of the versioned recipe contract. For example, highlight spreading should use a defined linear-light working stage; the artistic colour transform can have its own declared encoding. Converting a JPEG to linear light does not turn it back into RAW sensor data.

Skia provides runtime shaders and colour-space conversion helpers. Its working surface, image colour conversion, shader coordinates and premultiplied alpha rules need explicit handling. Numerical LUT textures must not receive unintended colour conversion. Verify the necessary APIs in the installed bindings rather than assuming every native Skia feature is exposed. [Skia runtime effects and colour handling](https://skia.org/docs/user/sksl/), [React Native Skia runtime image filters](https://shopify.github.io/react-native-skia/docs/image-filters/runtime-shader/)

Implementation requirements:

- Use a shared `FilmRecipe` and `renderFilm` core with preview and full-photo adapters.
- Compile shaders when loading a stock, not for every frame. Download data, LUTs and textures only; ship executable shader code in the app.
- Avoid copying full live frames into JavaScript or converting them to base64.
- Refactor crop/export so it does not repeatedly encode JPEGs or delete the only recoverable source.
- Run full-photo work through a measured execution path with bounded concurrency. An async function alone does not move synchronous decode/render/encode work off the JavaScript thread.
- Dispose native images, surfaces and temporary resources. A 12-megapixel RGBA buffer alone is roughly 48 MB; multiple surfaces and the camera can multiply that.
- Default to one final render at a time. Use small intermediate surfaces for blur, and preserve capture resolution unless an explicit output policy changes it.

Proposed persistent frame states: `reserved → captured → rendering → ready`, with `render_failed` retaining the source and recipe.

Reserve a frame ID and seed before capture. A camera failure releases that reservation. Once the source is durably saved, count that frame exactly once even if rendering fails. A retry resumes that same frame; it neither consumes another exposure nor silently substitutes an unfiltered image.

Write the output to a temporary file, verify it, then promote it and persist the ready record. Test interruption between every step; do not assume a file move and a separate JSON write are one atomic transaction. Keep a small recoverable journal or use a transactional local store for this workflow.

Only delete temporary source files after the final output and its record are safely committed. Failed or interrupted renders keep their source. There is no need to export unfiltered sources into the user's gallery.

Repeat renders should match within a defined visual tolerance on supported hardware. Exact byte-for-byte equality across GPUs and JPEG encoders is not promised. Once a final file exists, preserve its bytes and hash rather than relying on rerendering.

## 6. Where the user's filmstocks are stored

Three things need separate homes:

| Data                           | Authoritative home                                                                 | Device copy                                     | Purpose                                              |
| ------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| Stock definition and recipe    | Version-controlled release catalog plus immutable hosted bundles                   | App-private files; starter bundled with the APK | Defines the look.                                    |
| Permanent purchase entitlement | Worker D1, backed by a verified Solana payment record                              | Wallet/cluster-scoped verified cache            | Records who can use a paid stock.                    |
| Roll/frame result              | Local capture records and final image; existing upload/mint pipeline after minting | Persistent app photo storage                    | Preserves the actual photograph and the recipe used. |

Proposed device organization:

- `Paths.document/filmstocks/<stockId>/<recipeVersion>/...` for installed recipes and assets.
- `Paths.document/film-library/<cluster>/<wallet>.json` for the cached library and receipts.
- A capture journal and photos directory for in-progress sources and final output.
- Relative paths in persisted records, resolved against the current document directory when opened.

Use document storage for installed stocks needed offline. Expo distinguishes it from cache storage, which the system can evict under storage pressure. Reinstalling or clearing app data can still remove device files. [Expo SDK 54 FileSystem](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/)

Behaviour:

- The free starter is available without a film purchase or separate entitlement claim.
- After purchase, install the complete stock and verify its hash before offering “Load.”
- Reopening the app or going offline does not remove an installed stock.
- Restoring the same wallet on a new phone retrieves paid access and downloads recipes again. It does not recover unminted photos that existed only on the old phone.
- Wallet changes select a different library. Pause a loaded roll owned by another wallet; never silently relabel it.
- A loaded roll can keep shooting offline using its recorded owner and installed recipe. Authentication/network availability is not checked at every shutter press.
- Retirement ends new sales, not existing owners' use. Keep old recipe versions downloadable and retain versions referenced by unfinished renders.

Treat cached access as an offline convenience, not the server's authority. The Worker should verify ownership again when attaching a paid stock to a new roll.

Purchases do not require an entitlement NFT or a new on-chain program for this release. The payment is on Solana; the usage entitlement is maintained by Momints. This means restore depends on the service and its database backups. Recipes processed on a user's phone cannot be made impossible to extract; app gating is not unbreakable DRM.

## 7. Proposed data contracts

These are design shapes, not code already present.

### Stock catalog entry

`stockId, displayName, description, access(free|paid), currentRecipeVersion, minimumRendererVersion, priceAtomic, saleStartsAt, saleEndsAt, sampleImages`

Keep price and availability separate from recipe files so a price change does not alter old photographs. For launch, recommend a fixed SKR price per stock, set in the server catalog; do not derive it from normal roll fees or Jupiter exchange quotes.

### Immutable recipe bundle

`schemaVersion, stockId, recipeVersion, rendererVersion, inputColourSpace, outputColourSpace, tone/colour parameters or LUT reference, grain parameters, highlight parameters, spatial parameters, asset hashes, recipeHash`

Record hashes using a deterministic manifest/serialization scheme. Validate allowed fields, parameter ranges, file sizes, LUT dimensions and renderer compatibility. The free starter and simple parameter-only launch stocks may be bundled in the APK; remote bundles allow later releases without replacing the app, provided the installed renderer supports them.

### Roll film selection

`stockId, recipeVersion, recipeHash, rendererVersion, wallet, cluster`

Persist this on the active session, roll registry and Worker roll row. Entitlements apply to the stock ID; each loaded roll pins a specific compatible recipe version. Recommend including future improvements to that stock in the original unlock, while keeping old versions for existing rolls.

### Frame render record

`photoId, rollId, frameIndex, seed, stockId, recipeVersion, recipeHash, rendererVersion, sourceRelativePath, outputRelativePath, renderState, errorCode, width, height, outputHash`

Store a snapshot of the selected recipe reference and seed before rendering. Do not use the currently selected stock when resuming a capture.

### Server records

- `film_purchase_orders`: order ID, authenticated wallet, cluster, stock ID, quoted amount, mint/program/recipient, order reference, transaction lifetime details, status, signature and timestamps.
- `film_entitlements`: unique `(cluster, wallet, stockId)`, source order and grant time.
- A shared payment-claim record: unique `(cluster, signature)`, purpose and order/resource ID, to prevent a single payment funding multiple products.
- Authentication challenges/session state as required by the chosen SIWS implementation.
- Stock fields on existing roll records; unknown legacy values remain explicitly legacy.

Use integer token amounts, serialized as strings across API/JSON boundaries. Avoid floating-point money calculations. Do not reuse the current one-quote-per-wallet roll table for a permanent filmstock purchase.

## 8. SKR purchase and restore flow

1. Browse the catalog and samples. Show “Unlock permanently” and explain that roll fees are separate.
2. Connect and authenticate the wallet when buying or restoring paid access. Return existing ownership before offering another payment.
3. Create a server order with a client idempotency key. The server chooses the stock price, mint, recipient, cluster and unique reference.
4. Present the exact SKR amount and any SOL network cost. The purchase is SKR-only; do not inherit the roll flow's SOL fallback.
5. Request a wallet-signed SKR TransferChecked with the order reference in the same transaction.
6. Persist the order, signature and signed transaction/lifetime information before broadcasting where the wallet API permits.
7. The Worker retrieves and verifies the transaction from its configured RPC. Return a pending state until the chosen settlement level is reached; grant the permanent entitlement at finalized commitment.
8. Commit the payment claim, order completion and entitlement together. Repeated completion requests return the existing result.
9. Download/verify the recipe and show it in “My film.”
10. On restart, resume unfinished orders before offering a second purchase.

The existing mint address matches Solana Mobile's published SKR address. The repo config uses six decimals; verify the mint's actual owner/program and decimals in deployment checks. TransferChecked explicitly supplies mint and precision. [Solana Mobile SKR announcement](https://solanamobile.com/blog/skr-is-live), [Solana token transfer documentation](https://solana.com/docs/tokens/basics/transfer-tokens)

Verification must bind the successful transfer to the exact order, buyer, stock, cluster, token, recipient and amount. Check the source token-account owner/authority and required wallet signature, not only who paid the transaction fee or a positive treasury balance delta. Reject a reference used for another order.

The current SKR fee helper allows a 2% amount tolerance and its callers check quote expiry against verification time. A fixed-price stock order needs exact pricing and a recovery policy that still honours a valid payment if the API is retried later.

For launch, have each payment attempt use a recorded recent blockhash/lifetime. Accept late verification of a valid landed transaction; an HTTP timeout or a sale ending must not erase that payment. If a transaction's outcome is unknown, continue reconciliation. Offer a fresh payment only once the previous attempt is definitively failed or expired without landing. Keep old attempts traceable, including if a sale window has closed.

Cross-product replay matters: the existing roll and quick-mint records enforce signature uniqueness in their own tables. If film purchases use the same treasury, introduce the shared claim mechanism across all relevant paths and reject mismatched payment purposes. Backfill existing claims before enabling sales; inspect any historical conflicts. A new film-only table by itself does not prevent another endpoint from accepting the same transfer.

### Wallet authentication

Use a server-issued one-time challenge with domain, wallet, chain, issued time, expiry and nonce. Verify the returned SIWS message/signature on the Worker and consume the nonce. Use the existing wallet abstraction where supported, with an equivalent signed-message challenge as fallback.

Connecting a wallet in the app is not sufficient proof to an HTTP backend that a caller owns an address. Keep authentication prompts at purchase/restore/session renewal, not in the camera loop. [Solana Mobile SIWS integration](https://docs.solanamobile.com/get-started/react-native/invoke-mwa-sessions-directly), [SIWS specification](https://github.com/phantom/sign-in-with-solana)

### Proposed endpoints

| Endpoint                                     | Responsibility                                                      |
| -------------------------------------------- | ------------------------------------------------------------------- |
| GET /filmstocks                              | Catalog, free stock, supported recipes, samples and current prices. |
| POST /auth/challenge and /auth/verify        | Prove wallet control and establish a limited session.               |
| GET /me/filmstocks                           | Restore that wallet's permanent purchases.                          |
| POST /filmstock-orders                       | Idempotently create an order or return already-owned status.        |
| GET /filmstock-orders/:id                    | Resume pending payment/fulfilment.                                  |
| POST /filmstock-orders/:id/confirm           | Verify the same payment and grant access once.                      |
| GET /filmstocks/:id/versions/:version/bundle | Deliver a compatible recipe, checking paid access where applicable. |

Use HTTPS and rate limits. Keep payment credentials and authentication proofs out of analytics logs.

## 9. Roll and mint integration

Extend roll creation to accept the immutable stock reference. Authenticate the wallet and check entitlement/recipe compatibility before charging for or creating the roll. Store the accepted values on the Worker row and return them in the response.

Add human-readable film name plus stable stock ID and recipe version to roll/frame metadata. The Worker should derive reserved film traits from its roll record and reject client overrides. Optional recipe/output hashes support traceability; they do not prove the phone applied the effect correctly or prove the original scene was unedited.

The renderer's finished file is the image uploaded through the existing storage pipeline. Film purchase receipts do not need to become public photo attributes.

Migration rules:

- Existing colour/B&W rolls keep their original look. Do not assign the new starter retroactively.
- Map old settings to explicit legacy recipes; preserve already processed photos without rerendering.
- Existing clients that omit stock fields use legacy behaviour. They cannot claim a paid stock by adding arbitrary attributes at mint time.
- Hydration retains new recipe fields, identifies unknown versions and preserves recoverable pending frames.
- Recover a legacy active roll's wallet from its collection/registry where possible. If ownership cannot be established, preserve the data and resolve it before paid-stock actions.
- Adding paid stocks must not break regular Colour/B&W, Quick captures or existing roll mint retries.

## 10. Execution stages and acceptance criteria

### Stage A — renderer proof

Build an internal workbench and a single free starter recipe. Demonstrate tone/colour, grain and optional highlight glow on fixture photos and captured Seeker images. Attempt the v4 live-preview integration in an isolated change.

Deliver:

- Approved before/after samples and recipe v1.
- Measured full-photo latency, peak memory and preview frame times in an Android release build.
- A documented decision on live preview, dependency compatibility and execution thread.
- Orientation, aspect and front-camera mirroring verified.

Provisional targets: stable 30 fps preview where supported, no sustained memory growth, and about two seconds or less for a representative 12 MP final render on Seeker. These are targets to measure, not established performance. If missed, optimize passes or choose a transparent reduced scope before expanding the catalog.

### Stage B — reliable free-stock rolls

Integrate stock selection, recipe pinning, local installation and capture recovery. Add server roll metadata and legacy migrations.

Acceptance:

- A full roll uses one recipe version.
- Force-close during capture/render and recover without duplicate frames or lost sources.
- Simulated write/decode/shader failure never marks an unfiltered image as successfully rendered.
- Updating the catalog during a roll does not change its look.
- Offline shooting of an already loaded roll works.
- Preview, export and mint use the intended recipe; existing reveal behaviour stays intact.

### Stage C — permanent SKR purchases

Implement wallet authentication, catalog pricing, orders, shared payment claims and entitlements. Exercise the lifecycle with a test token on a separate test cluster before any authorized real SKR purchase.

Acceptance:

- One payment grants one stock; repeating the request neither charges nor grants again.
- An already-owned stock cannot be accidentally repurchased through ordinary UI or API retries.
- Wrong wallet, mint, amount, recipient, purpose, chain, signature and replayed challenge are refused.
- Film/roll/quick-mint cross-purpose replay and concurrent confirmation attempts fail safely.
- A payment followed by app shutdown, lost response or delayed RPC availability is restored.
- A valid payment remains recoverable after its order window or sale closes.
- The same wallet restores on a second device; another wallet does not inherit access.
- Purchased access survives retirement, with the recipe still downloadable.

### Stage D — catalog and release

Tune the two paid stocks with the same fixture suite and renderer, create representative samples, finish the film library, and verify a complete capture-to-mint demonstration.

For a hackathon-sized delivery, cut complex simulated chemistry, arbitrary user LUT import, per-shot editing, transferable entitlement NFTs, artificial leaks, Pro camera controls and external-camera support from this feature's critical path.

## 11. Implementation map

Suggested new modules:

- `src/film/types.ts`, `catalog.ts`, `recipes/`, `shaders/`, `render.ts` and `preview.ts`.
- `src/services/filmLibrary.ts` and `filmPurchaseApi.ts`.
- `src/store/filmLibrary.ts` and a durable capture/order journal.
- `src/hooks/useFilmPurchase.ts`.
- Worker `filmstocks/`, `auth/` and shared payment-claim services.
- New numbered migrations after the current migration sequence.

Existing files to extend are linked in section 2, plus [rollRegistry.ts](D:/Claude/momints/src/store/rollRegistry.ts), [useCreateRoll.ts](D:/Claude/momints/src/hooks/useCreateRoll.ts), [useMintRoll.ts](D:/Claude/momints/src/hooks/useMintRoll.ts) and [rollApi.ts](D:/Claude/momints/src/services/rollApi.ts).

Use the existing MWA/Kit transaction boundary and Worker infrastructure. Evaluate any new checkout library against React Native compatibility and actual missing capabilities before introducing it. A web-oriented payment UI or framework migration is unnecessary for this plan.

## 12. Measure whether it creates repeat use

Proposed events: sample viewed, stock unlocked, stock loaded, roll completed, second roll with owned stock, restore succeeded, render failed and purchase recovery succeeded.

Measure free-stock adoption, first-to-second-roll return, reuse of paid stocks, roll completion, purchase conversion and recovery failures. Returning to shoot another roll is more useful than counting catalog visits alone.

Use aggregate or opt-in telemetry consistent with the app's privacy policy. Photos, precise location and signed wallet messages are not needed for these measurements.

Next development action: complete Stage A with Momints Everyday and approve its real-device results before committing to a larger paid collection.
