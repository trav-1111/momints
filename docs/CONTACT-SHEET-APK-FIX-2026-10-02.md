# Contact-sheet logo loading in standalone Android builds

The standalone APK could not generate contact sheets because the logo reader
passed a bundled Android drawable name to Expo File. Expo Asset intentionally
returns drawable resource names for bundled Android images; those names are not
filesystem paths. The installed APK contains `drawable/assets_adaptiveicon`.

The compositor now reads the logo using `Skia.Data.fromURI`, whose Android native
implementation opens drawable resources as well as file and HTTP URIs. Frame
downloads, sequential rendering, original aspect ratios, and temporary-image
cleanup remain unchanged.

Four regression tests exercise the actual TypeScript renderer with mocked native
boundaries: bundled drawable, local-file and HTTP logo inputs, plus native loading
failure. They verify successful output, native-resource disposal, and deletion of
temporary frame inputs on both success and failure. All 99 app tests, typecheck,
focused lint and formatting passed.

The APK was built from the fix commit on `codex/submission-candidate`,
`b7de99c5199f3ffe36307f5d14708ebc567c64f6`. Its standalone APK was rebuilt,
audited and installed in place on Seeker using the existing signing certificate.
The APK pulled back from the device exactly matches the audited artifact, with
SHA-256 `222f178479d1d31f4bfafa544f640719a4454b06fe217f603f09478a8b5a920a`.

The original error was reproduced using the existing completed 12-frame Martha
roll. The same roll now renders successfully, and visual inspection confirms the
logo is present. All 44 visible history labels match the pre-update record.
A cold-restart render also passed after one retry: the first attempt encountered
an external Arweave image HTTP 404 before logo loading. The unchanged roll
rendered on retry. This gateway availability issue is separate from the fixed
bundled-logo failure. No fresh relevant runtime errors were logged, and the final
preview was left open without saving to the gallery or sharing it.
Private APK and device evidence stays under the ignored
`.expo/contact-sheet-fix-20261002/` directory. No payments, mints, permanent
uploads, Worker changes, pushes or merges occurred during the fix delivery. The four pre-existing
pending working files were restored byte-for-byte after the isolated build.

The locally accessible APK is
`.expo/submission-candidate-apk-20261001/momints-hackathon-only-debug-signed-b7de99c5-arm64.apk`.
It remains ignored rather than committed to Git. Subsequent verification-note
updates do not change its committed runtime source.
