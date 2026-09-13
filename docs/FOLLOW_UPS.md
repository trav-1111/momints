# Follow-ups

## Authenticate roll frame and completion requests

- **Priority:** High
- **Status:** Deferred for later attention; recorded 2026-09-11.
- **Found on:** `hackathon`, commit `bf311c43a0595b408fa03676267b091c905e5eb2`.

### Finding

The Worker does not authenticate the caller of these mutation endpoints:

- `POST /rolls/<collection>/frames`
- `POST /rolls/<collection>/complete`

The routes dispatch directly to their handlers using the collection address.
Frame minting looks up the roll and validates the frame index, but does not
verify that the caller controls the roll owner's wallet. Completion likewise
does not verify the caller's ownership.

If these endpoints are reachable without an external authorization layer, a
caller who knows an open roll's public collection address could submit images
using its prepaid frame allowance or close the roll before its owner finishes.
This finding is based on source inspection; no live mutation was attempted.

### Later work

- Authenticate roll mutations and bind authorization to the stored roll owner.
- Preserve the intended experience of no wallet approval for each roll frame.
- Test missing, invalid, expired, and wrong-wallet authorization, plus authorized
  mint retries and completion. Rejected requests must not spend storage credits,
  send transactions, or change roll state.

### Source

- [Worker routing and handlers](../worker/src/index.ts): `handleMintFrame`,
  `handleCompleteRoll`, and the `mint-frame` / `complete-roll` route cases.
- [Frame minting](../worker/src/rolls/frames.ts): `mintFrame`.
