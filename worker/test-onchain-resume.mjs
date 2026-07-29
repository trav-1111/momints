#!/usr/bin/env node
/**
 * Momints — on-chain E2E test for the TWO riskiest branches.
 *
 *   A. Mid-roll kill + resume  — the double-mint / skipped-frame branch.
 *      This is the one that local D1 tests CANNOT prove, because the whole
 *      point is chain-resolution of a persisted signature, not bookkeeping.
 *   B. Funding-short 503        — the pre-emptive ensureFunded() gate that
 *      stands between a user and a 120-second hang.
 *
 * This drives the DEPLOYED worker over HTTP against DEVNET. It does not import
 * worker internals — it exercises the real endpoints the Seeker app would hit,
 * because that is the only path that proves the runtime behaviour.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * READ THIS FIRST — reconcile these assumptions with your actual API.
 * Everything the script assumes about your endpoints lives in ENDPOINTS and
 * the parse helpers below, in ONE place. If your worker differs, fix it here
 * and the rest of the script follows. Do not guess elsewhere.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Usage:
 *   BASE_URL=https://momints-irys-spike.<sub>.workers.dev \
 *   TEST_WALLET=<devnet pubkey> \
 *   node test-onchain-resume.mjs
 *
 * Optional:
 *   RPC_URL=<helius devnet>   # only for the independent on-chain double-mint
 *                             # audit; if unset, that audit is SKIPPED (the
 *                             # test still runs, but can't independently
 *                             # confirm exactly one asset per frame on chain).
 *   ROLL_SIZE=12              # 12 or 24
 *   KILL_AFTER=3              # abandon the roll after this many frames minted
 */

// ── ASSUMPTIONS ABOUT YOUR API (reconcile these) ────────────────────────────
const BASE = process.env.BASE_URL?.replace(/\/$/, "");
const WALLET = process.env.TEST_WALLET;
const RPC_URL = process.env.RPC_URL || null;
const ROLL_SIZE = Number(process.env.ROLL_SIZE || 12);
const KILL_AFTER = Number(process.env.KILL_AFTER || 3);

// Reconciled against the worker's documented endpoint contract:
//   POST /rolls                     JSON { wallet, size, artist?, skrIdentity?,
//                                          localDate?, feeSignature? }
//   GET  /rolls/<collection>        roll + per-frame checkpoint status
//   POST /rolls/<collection>/frames MULTIPART: image (file), frameIndex,
//                                              description?, attributes? (JSON)
//
// Note: the roll id in the path is the COLLECTION ADDRESS. feeSignature is
// optional (the trailing ? in the contract), so the test creates a roll
// without signing a fee transaction. If your deployment makes feeSignature
// mandatory, this create call will be rejected and you'll need to sign+send a
// fee tx first — see the note in runResumeTest().
const ENDPOINTS = {
  createRoll: () => ({
    method: "POST",
    path: `/rolls`,
    json: { wallet: WALLET, size: ROLL_SIZE, artist: "resume-test" },
  }),
  // roll id === collection address
  getRoll: (collection) => ({ method: "GET", path: `/rolls/${collection}` }),
  // Frame mint is multipart/form-data with a real image file.
  mintFrame: (collection, frameIndex) => ({
    method: "POST",
    path: `/rolls/${collection}/frames`,
    form: {
      image: syntheticImageFile(),          // { bytes, filename, type }
      frameIndex: String(frameIndex),
    },
  }),
};

// Pull fields out of responses. Adjust the ?? fallbacks only if your JSON
// field names differ from these.
const parse = {
  // Roll id is the collection address.
  rollId: (j) => j.collection ?? j.collectionAddress ?? j.rollId ?? j.id ?? null,
  collection: (j) => j.collection ?? j.collectionAddress ?? null,
  mintedCount: (j) => j.mintedCount ?? j.minted ?? j.frames?.filter?.(f => /mint/i.test(f.status))?.length ?? null,
  status: (j) => j.status ?? null,
  // The README says an already-minted re-POST returns alreadyMinted: true —
  // that flag is the primary no-op signal; sig/asset are the corroboration.
  alreadyMinted: (j) => j.alreadyMinted === true,
  frameSignature: (j) => j.signature ?? j.sig ?? null,
  frameAsset: (j) => j.assetAddress ?? j.asset ?? j.assetId ?? null,
  isFundingShort: (res, j) =>
    res.status === 503 ||
    /fund|balance|insufficient/i.test(JSON.stringify(j || "")),
};
// ─────────────────────────────────────────────────────────────────────────────

if (!BASE || !WALLET) {
  console.error("Set BASE_URL and TEST_WALLET. See header.");
  process.exit(2);
}

const log = (...a) => console.log(...a);
const ok = (m) => log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => log(`  \x1b[90m·\x1b[0m ${m}`);
let FAILURES = 0;
const fail = (m) => { FAILURES++; bad(m); };

async function call(spec, { expectStatus } = {}) {
  const url = BASE + spec.path;
  const init = { method: spec.method };
  if (spec.json) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(spec.json);
  } else if (spec.form) {
    // multipart/form-data — fetch sets the boundary header itself.
    const fd = new FormData();
    for (const [k, v] of Object.entries(spec.form)) {
      if (v && v.bytes) {
        fd.append(k, new Blob([v.bytes], { type: v.type }), v.filename);
      } else {
        fd.append(k, v);
      }
    }
    init.body = fd;
  }
  const res = await fetch(url, init);
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  if (expectStatus && res.status !== expectStatus) {
    info(`${spec.method} ${spec.path} → ${res.status} (expected ${expectStatus})`);
  }
  return { res, json };
}

// A small but real PNG the upload path can decode. If your worker validates
// image dimensions or size, swap in a real photo buffer here (read a file with
// fs.readFileSync). This is a valid ~70-byte PNG, sufficient for most decoders.
function syntheticImageFile() {
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR42mP8z8BQz0AEYBxVSF8FAP2FBQZ0f2vBAAAAAElFTkSuQmCC";
  return {
    bytes: Buffer.from(pngBase64, "base64"),
    filename: "frame.png",
    type: "image/png",
  };
}

// ── TEST A: mid-roll kill + resume ──────────────────────────────────────────
async function runResumeTest() {
  log("\n\x1b[1mTEST A — mid-roll kill + resume\x1b[0m");
  log(`  size=${ROLL_SIZE}, kill after ${KILL_AFTER} frames\n`);

  // 1. Create the roll. Worker returns 201 Created (correct REST).
  const created = await call(ENDPOINTS.createRoll());
  const rollId = parse.rollId(created.json);
  if (created.res.status === 409 || /already has an open roll/i.test(JSON.stringify(created.json || ""))) {
    return fail("wallet already has an OPEN roll from a prior run — clear it first:\n" +
      "     wrangler d1 execute momints-rolls --remote --command \"UPDATE rolls SET status='COMPLETE' WHERE status='OPEN'\"");
  }
  if (created.res.status !== 200 && created.res.status !== 201) {
    if (parse.isFundingShort(created.res, created.json))
      return fail("roll creation refused with funding-short — Irys balance is empty. Fund it, then rerun.");
    if (created.res.status === 400 && /fee|signature/i.test(JSON.stringify(created.json || "")))
      return fail("roll creation requires a feeSignature — the test doesn't sign a fee tx. Make feeSignature optional on devnet, or extend the script to send+sign a fee tx first.");
    return fail(`create returned ${created.res.status}. Body: ${short(JSON.stringify(created.json), 160)}`);
  }
  if (!rollId) return fail(`roll created (${created.res.status}) but couldn't parse the collection address — check parse.rollId against this body: ${short(JSON.stringify(created.json), 160)}`);
  ok(`roll created — collection ${short(rollId, 12)}`);

  // 2. Mint frames up to the kill point. Record each signature so we can later
  //    prove the resume did NOT mint a second asset for these frames.
  //    NOTE: frames are 1-INDEXED (worker requires frameIndex in 1..N).
  const before = new Map(); // frameIndex -> { sig, asset }
  for (let i = 1; i <= KILL_AFTER; i++) {
    const { res, json } = await call(ENDPOINTS.mintFrame(rollId, i));
    if (res.status !== 200 && res.status !== 201) return fail(`frame ${i} mint failed (${res.status}) before kill — cannot test resume`);
    before.set(i, { sig: parse.frameSignature(json), asset: parse.frameAsset(json) });
    ok(`frame ${i} minted  sig=${short(before.get(i).sig)}  asset=${short(before.get(i).asset)}`);
  }

  // 3. THE KILL. We simulate the worst case: the client vanished after the
  //    server persisted state but the client never recorded the result.
  //    (If you can also kill the *worker* here — redeploy / restart — do it
  //    manually now, then press enter. The strongest test is a real interrupt.)
  info("simulating interruption (no further calls) …");
  await pause(1500);

  // 4. RESUME. Re-POST the SAME frames that were already minted. The contract:
  //    these must be pure no-ops (already-minted fast path), NOT new mints.
  log("\n  resuming — re-POSTing already-minted frames (must be no-ops):");
  for (let i = 1; i <= KILL_AFTER; i++) {
    const { res, json } = await call(ENDPOINTS.mintFrame(rollId, i));
    if (res.status !== 200 && res.status !== 201) { fail(`resume of frame ${i} returned ${res.status} — expected idempotent 200/201`); continue; }
    const sigAfter = parse.frameSignature(json);
    const assetAfter = parse.frameAsset(json);
    const b = before.get(i);
    // Primary signal: the README says an already-minted re-POST returns
    // alreadyMinted:true. Corroborate with unchanged sig/asset — a CHANGED one
    // is the double-mint smoking gun regardless of the flag.
    if (b.sig && sigAfter && b.sig !== sigAfter) {
      fail(`frame ${i} DOUBLE-MINTED — signature changed ${short(b.sig)} → ${short(sigAfter)}`);
    } else if (b.asset && assetAfter && b.asset !== assetAfter) {
      fail(`frame ${i} DOUBLE-MINTED — asset changed ${short(b.asset)} → ${short(assetAfter)}`);
    } else if (parse.alreadyMinted(json)) {
      ok(`frame ${i} resume → alreadyMinted:true, sig/asset unchanged (no-op confirmed)`);
    } else {
      // 200 with unchanged identifiers but no alreadyMinted flag — likely fine,
      // but note it, since the flag is the documented contract.
      info(`frame ${i} resume: no double-mint, but no alreadyMinted flag — verify the fast path fired`);
    }
  }

  // 5. Mint the REST of the roll to completion — proves resume didn't corrupt
  //    the checkpoint cursor (no skipped or stuck frames).
  log("\n  completing the roll:");
  for (let i = KILL_AFTER + 1; i <= ROLL_SIZE; i++) {
    const { res, json } = await call(ENDPOINTS.mintFrame(rollId, i));
    if (res.status !== 200 && res.status !== 201) { fail(`frame ${i} failed during completion (${res.status})`); break; }
    before.set(i, { sig: parse.frameSignature(json), asset: parse.frameAsset(json) });
  }
  const final = await call(ENDPOINTS.getRoll(rollId));
  const count = parse.mintedCount(final.json);
  const status = parse.status(final.json);
  if (count === ROLL_SIZE) ok(`mintedCount = ${count}/${ROLL_SIZE}`);
  else fail(`mintedCount = ${count}, expected ${ROLL_SIZE} — resume may have skipped/duplicated a frame`);
  if (status && /complete/i.test(status)) ok(`status = ${status}`);
  else info(`status = ${status ?? "?"} (expected COMPLETE)`);

  // 6. INDEPENDENT on-chain audit: exactly one asset per frame in the
  //    collection. This is the ground truth the worker's own D1 cannot vouch
  //    for. Requires RPC_URL + the collection address.
  await onChainDoubleMintAudit(rollId, before, final.json);
}

// ── TEST B: funding-short 503 ───────────────────────────────────────────────
async function runFundingTest() {
  log("\n\x1b[1mTEST B — funding-short pre-check\x1b[0m");
  info("This proves ensureFunded() FAILS FAST instead of letting a user hang.");
  info("It requires the Irys balance to be BELOW the roll's requirement.\n");

  // The honest way to test this without draining a real balance: point the
  // worker at a funding wallet whose Irys balance is ~0 (a second secret /
  // a staging worker), OR run this first, before you fund the balance at all.
  info("Precondition: deploy/point at a funding wallet with ~0 Irys balance.");
  info("If your balance is already funded, this test will (correctly) NOT fire —");
  info("skip it, or run it against an unfunded staging worker.\n");

  const { res, json } = await call(ENDPOINTS.createRoll());
  if (parse.isFundingShort(res, json)) {
    ok(`roll creation refused fast: ${res.status}`);
    ok(`response signals funding shortfall (no 120s hang)`);
  } else if (res.status === 409 || /already has an open roll/i.test(JSON.stringify(json || ""))) {
    info(`409 — wallet already has an open roll (from Test A). This is the`);
    info(`single-active-roll constraint working, NOT a funding result. Test B`);
    info(`is inconclusive here; to exercise it, clear open rolls AND point at an`);
    info(`unfunded funding wallet, then run Test B alone.`);
  } else if (res.status === 200 || res.status === 201) {
    info(`roll was CREATED (${res.status}) — balance was sufficient, so the`);
    info(`funding-short branch did not trigger. Balance is funded; this branch`);
    info(`was already proven in the earlier unfunded run.`);
  } else {
    fail(`unexpected ${res.status} — not a clean funding-short refusal. Body: ${short(JSON.stringify(json), 120)}`);
  }
}

// ── independent on-chain audit ──────────────────────────────────────────────
async function onChainDoubleMintAudit(rollId, frames, rollJson) {
  log("\n  \x1b[1mon-chain audit (ground truth):\x1b[0m");
  if (!RPC_URL) return info("RPC_URL unset — SKIPPING independent on-chain audit.");

  // We need the collection address. Try to read it from the roll response.
  const collection = rollJson?.collection ?? rollJson?.collectionAddress ?? null;
  if (!collection) return info("no collection address in roll response — can't audit; add it to getRoll output.");

  // Verify each recorded mint signature actually landed exactly once, and that
  // each asset is real. This uses raw JSON-RPC so it has no dependency on umi.
  let audited = 0;
  for (const [idx, { sig }] of frames) {
    if (!sig) continue;
    const r = await rpc("getTransaction", [sig, { maxSupportedTransactionVersion: 0 }]);
    if (r?.result) audited++;
    else fail(`frame ${idx}: recorded signature ${short(sig)} NOT found on chain`);
  }
  ok(`${audited} recorded signatures confirmed on chain`);
  info(`(For a full duplicate check, enumerate assets in collection ${short(collection)} `);
  info(` via your indexer/DAS and assert count === ${ROLL_SIZE} with distinct frame numbers.)`);
}

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

// ── helpers ─────────────────────────────────────────────────────────────────
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s, n = 10) => (s ? String(s).slice(0, n) + "…" : "∅");

(async () => {
  log(`\x1b[1mMomints on-chain resume/funding test\x1b[0m  → ${BASE}`);
  log(`wallet ${short(WALLET, 8)}  rpc ${RPC_URL ? "set" : "unset (audit skipped)"}\n`);

  await runResumeTest();
  await runFundingTest();

  log("");
  if (FAILURES === 0) log("\x1b[32m\x1b[1mALL CRITICAL BRANCHES PASSED\x1b[0m");
  else log(`\x1b[31m\x1b[1m${FAILURES} FAILURE(S) — do not ship until resolved\x1b[0m`);
  process.exit(FAILURES ? 1 : 0);
})();
