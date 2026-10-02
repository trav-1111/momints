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

The rebuilt standalone APK still requires device verification. Installation uses
the existing signing certificate and an in-place update to preserve app data.
Private APK and device evidence stays under ignored `.expo` directories.
