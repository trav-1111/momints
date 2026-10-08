# Filmstock package template

1. Copy this directory and rename it to the immutable `filmStockId`.
2. Replace every `replace-me-v1` value in `recipe.json` with that ID.
3. Add `source/<filmStockId>.cube`, exported as a 33-point SDR sRGB 3D LUT with a 0-1 domain.
4. Add at least one JPG, PNG, or WebP under `previews/`.
5. Complete the attribution and authoring notes.
6. Run `npm run publish:filmstock -- --package <directory> --test-images <canonical-test-directory>` from `worker/`.

The publishing command creates the optimized runtime LUT; do not author that binary by hand.
