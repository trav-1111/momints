# Tester roll recovery assessment — 11 October 2026

The original paid 12-frame Martha roll is technically recoverable. It is not ready for automatic Resume: the database marks it COMPLETE and Momints' on-chain delegate has been revoked. Restoring the existing collection requires the tester's wallet approval, consistent backend reopening and usable device authorization. No production repair has been executed.

## Current read-only evidence

Checked at **10:28:59 Brisbane** against production D1, finalized Solana state and public Arweave metadata:

- Collection: `BmDiPataB7L7UPJZNj1dsL1HkNsyyA1KNfg6vH6qhSE9`.
- Original roll `2026-10-11.01`, 12 exposures, Martha (`martha-v1` in its metadata).
- Original treasury payment: **84,038,086 lamports / 0.084038086 SOL**, finalized without error. Creation and delegate revocation also finalized without error.
- Database COMPLETE, `minted_count=0`, no frame checkpoint rows. Collection `numMinted=0`, `currentSize=0`.
- Tester remains the collection update authority. UpdateDelegate authority is `UpdateAuthority`, with no additional delegates; the Worker is not authorized.
- No other roll or pending creation exists for this wallet. Public open-roll lookup returns HTTP 200 with `openRoll:null`, consistent with COMPLETE.
- Protocol version 2 and an existing capability hash. The original film/aspect columns are null because this record predates migration 0011; Martha is recoverable from metadata, original aspect is not established.

These checks establish the present state, not who closed the roll or why the original allowance failed to appear. They do not establish whether unuploaded photographs exist on the tester's device.

## Unsigned owner-approval simulation

At **10:30:49 Brisbane**, a single Core `approveCollectionPluginAuthority` instruction was built for the tester as authority and payer, restoring the existing Worker's UpdateDelegate authority on this exact collection. The 275-byte transaction remained unsigned. RPC simulation used `sigVerify:false` and a replacement recent blockhash; nothing was submitted.

Simulation succeeded with no program error, consuming 12,397 units. The returned simulated collection had the Worker delegate restored, the tester's root update authority preserved, and unchanged name, metadata URI and zero frame counts.

Estimated costs for that simulated transaction:

| Component | Lamports | SOL |
| --- | ---: | ---: |
| Network fee | 5,000 | 0.000005 |
| Collection account rent increase | 162,560 | 0.00016256 |
| Total | 167,560 | 0.00016756 |

The wallet's observed balance was sufficient. This estimate is not a fresh quote for a later transaction. Simulation does not substitute for the tester's actual signature or finalized verification. No new roll fee is required to restore this existing collection.

The mechanism follows Metaplex's [delegation and revocation model](https://www.metaplex.com/docs/smart-contracts/core/plugins/delegating-and-revoking-plugins) and [UpdateDelegate authority model](https://www.metaplex.com/docs/smart-contracts/core/plugins/update-delegate). This grants the Worker collection update/mint permissions; it does not transfer the tester's root authority.

## Device authorization must be resolved first

The existing server capability cannot be reconstructed from its hash. Read-only inspection has not established whether the tester retains the matching token. Same-installation updates normally preserve SecureStore, but app closure/discard paths can delete collection capabilities; retaining the installation alone is not proof that authorization remains usable.

The current `/authorize` endpoint accepts an already matching capability or a first claim for an unclaimed protocol-v1 roll. It does not rotate a protocol-v2 roll's existing capability. The current Resume flow also does not sign an on-chain delegate grant or reopen COMPLETE rolls.

- **Matching capability retained:** preserve it and verify an authenticated roll-detail read before reopening. The updated app can then load an empty OPEN roll using Martha from its metadata.
- **Capability absent or mismatched:** prepare an explicit wallet-verified capability replacement for this incident. Bind the signature to collection, wallet, new capability hash, purpose and freshness; stage the new token durably before the request. Preserve old authorization audit evidence and make retries idempotent. Do not clear `auth_hash`, downgrade protocol version or treat a public fee signature as authorization.
- **Local photographs or another active local roll found:** preserve the vault and inspect it before creating a replacement local session. Database/chain emptiness does not prove local emptiness.

The tester should retain the current installation and data while this is checked. No private token, seed phrase or private key needs to be sent to the operator.

## Concrete restoration sequence

1. Verify the original wallet and installation, authenticated capability access and local vault state. Preserve an incident audit snapshot, including the original payment, creation and handoff signatures. Resolve missing capability with wallet proof if necessary.
2. Recheck finalized collection authority/emptiness, database frame state, no other OPEN roll, no pending creation and no live frame operations. Coordinate a brief wallet-scoped recovery reservation or maintenance interval so a new purchase cannot race the repair.
3. Present a freshly built transaction for the tester to approve restoring the existing Worker's UpdateDelegate. Confirm the exact collection, delegate, payer, one-instruction purpose and current cost. Wait for finalization and read the actual resulting authority; simulation alone is insufficient.
4. In a guarded, audited backend operation, reopen this same paid roll to OPEN. Preserve payment, collection identity and frame count. Archive the original handoff evidence before resetting the active `handoff_signature` checkpoint to null; otherwise final completion would skip delegate revocation. Recheck the one-open-roll and pending-creation guards atomically. Preserve historical closure evidence rather than rewriting it as a new purchase.
5. Confirm authenticated roll detail and public open-roll discovery agree, then let the tester Resume in the updated app. Restore Martha, confirm the shooting aspect explicitly because its original value is unknown, and verify 12 unused exposures without another payment prompt. Verify the first frame and restart resume; final full-roll development should revoke the delegate again.

If chain approval lands but reopening is interrupted, reconcile the same collection and receipt. Do not create a replacement paid roll. If new activity makes reopening unsafe, pause and reconcile it before choosing a separate refund/credit remedy.

No step above has been executed beyond read-only inspection and unsigned simulation. Production schema/records, wallet authorization, balances and delegates remain unchanged. A wallet-assisted recovery action and an audited reopen operation still need implementation/execution; ordinary Resume alone cannot repair this historical closed roll.

## Evidence and checks

Private ignored evidence: `.expo/roll-investigation-2026-10-11/tester-recovery-current-private.json` and `tester-delegate-simulation-private.json`. Diagnostic scripts in the same directory perform only D1 SELECTs, public reads and unsigned simulation. The first read attempt used an incorrect frame table name; the corrected query succeeded. A public plugin offset required BigInt serialization; the completed report uses a serializer without exposing credentials.

This assessment changes documentation only. The seven existing camera/privacy fast-suite failures remain unrelated. See [the incident investigation](ROLL-PAYMENT-RECOVERY-INVESTIGATION-2026-10-11.md) and [the deployed recovery implementation](ROLL-PAYMENT-RECOVERY-IMPLEMENTATION-2026-10-11.md).
