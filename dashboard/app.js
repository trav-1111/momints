// Momints operator dashboard — vanilla JS, no build step, no dependencies.
// Read-only: every function here either fetches a GET /ops/dashboard/*
// endpoint or renders what came back. Nothing here can call a mutating
// route. See dashboard/README.md for deploy steps.

// ---- Config ---------------------------------------------------------------
// EDIT before deploying: the Worker's own URL (see worker/.env / EXPO_PUBLIC_ROLL_API
// in the app's .env for the same value already in use).
const WORKER_URL = 'https://api.momints.xyz'

const TOKEN_STORAGE_KEY = 'momints_ops_token'
const REFRESH_FAST_MS = 45_000 // wallets + health
const REFRESH_SLOW_MS = 5 * 60_000 // metrics
const SKR_DECIMALS = 6

class AuthError extends Error {}

// ---- Token storage ----------------------------------------------------------

function getToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || ''
  } catch {
    return '' // private browsing / storage blocked — falls through to the gate every load
  }
}
function setToken(token) {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    // Non-critical: the in-memory token (closure below) still works for this page load.
  }
}
function clearToken() {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

// ---- Fetch ------------------------------------------------------------------

async function fetchJson(path) {
  const token = getToken()
  let res
  try {
    res = await fetch(`${WORKER_URL}${path}`, { headers: { authorization: `Bearer ${token}` } })
  } catch (e) {
    throw new Error(`Network error reaching the Worker: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (res.status === 401) {
    throw new AuthError('Invalid or missing ops token')
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).error ?? ''
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`HTTP ${res.status}${detail ? ` — ${detail}` : ''}`)
  }
  return res.json()
}

// ---- Formatting ---------------------------------------------------------------

function formatSol(lamports) {
  return `${(lamports / 1_000_000_000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} SOL`
}
function formatSkr(atomic) {
  return `${(atomic / 10 ** SKR_DECIMALS).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} $SKR`
}
function formatAgo(iso) {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
function shortAddr(addr) {
  return addr && addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : (addr ?? '—')
}
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v
    else if (k === 'html') {
      const parsed = new DOMParser().parseFromString(v, 'image/svg+xml')
      const svg = parsed.documentElement
      if (svg && !parsed.querySelector('parsererror')) {
        node.appendChild(svg)
      }
    }
    else node.setAttribute(k, v)
  }
  for (const child of [].concat(children)) node.appendChild(child)
  return node
}
function statRow(label, value, tone) {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'label', text: label }),
    el('span', { class: `value${tone ? ` ${tone}` : ''}`, text: value }),
  ])
}

// ---- Charts (hand-rolled inline SVG — no charting library) ------------------

const CHART_COLORS = { quick: '#7d7bf0', roll: '#3ad07a', sol: '#7d7bf0', skr: '#facc15' }

function donutChart(segments, size = 120) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  const r = size / 2 - 8
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r
  let offset = 0
  const svgParts = [`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#24252f" stroke-width="14" />`]
  if (total > 0) {
    for (const seg of segments) {
      if (seg.value <= 0) continue
      const frac = seg.value / total
      const dash = frac * circumference
      svgParts.push(
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="14" ` +
          `stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}" ` +
          `transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt" />`,
      )
      offset += dash
    }
  }
  const centerLabel = total > 0 ? `${Math.round((segments[0].value / total) * 100)}%` : 'n/a'
  svgParts.push(
    `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="15" font-weight="600" fill="#f5f5f4">${centerLabel}</text>`,
  )
  return `<svg viewBox="0 0 ${size} ${size}" role="img">${svgParts.join('')}</svg>`
}

function barChart(days, width = 480, height = 140) {
  const padding = { top: 10, right: 4, bottom: 18, left: 4 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const max = Math.max(1, ...days.map((d) => d.total))
  const n = Math.max(1, days.length)
  const barW = Math.max(2, innerW / n - 3)

  const bars = days
    .map((d, i) => {
      const x = padding.left + i * (innerW / n) + (innerW / n - barW) / 2
      const quickH = (d.quick / max) * innerH
      const rollH = (d.roll / max) * innerH
      const rollY = padding.top + innerH - rollH
      const quickY = rollY - quickH
      const parts = []
      if (d.roll > 0) {
        parts.push(
          `<rect x="${x.toFixed(1)}" y="${rollY.toFixed(1)}" width="${barW.toFixed(1)}" height="${rollH.toFixed(1)}" fill="${CHART_COLORS.roll}" rx="1.5" />`,
        )
      }
      if (d.quick > 0) {
        parts.push(
          `<rect x="${x.toFixed(1)}" y="${quickY.toFixed(1)}" width="${barW.toFixed(1)}" height="${quickH.toFixed(1)}" fill="${CHART_COLORS.quick}" rx="1.5" />`,
        )
      }
      return `<g><title>${d.day}: ${d.total} (quick ${d.quick}, roll ${d.roll})</title>${parts.join('')}</g>`
    })
    .join('')

  const baselineY = padding.top + innerH
  return `<svg viewBox="0 0 ${width} ${height}" role="img">
    <line x1="${padding.left}" y1="${baselineY}" x2="${width - padding.right}" y2="${baselineY}" stroke="#24252f" stroke-width="1" />
    ${bars}
  </svg>`
}

// ---- Section: Wallets ---------------------------------------------------------

function renderWallets(data) {
  const body = document.getElementById('wallets-body')
  body.innerHTML = ''

  const signerCard = el('div', { class: 'card' }, [
    el('h3', { text: 'Signer wallet' }),
    el('div', { class: 'addr', text: data.signer.address }),
    statRow('SOL balance', formatSol(data.signer.solLamports)),
    statRow('Turbo credits', `~${data.signer.turbo.balanceCredits}`),
    statRow(
      'Storage headroom',
      `~${data.signer.turbo.rollsRemaining} rolls`,
      data.signer.turbo.rollsRemaining < 5 ? 'bad' : data.signer.turbo.rollsRemaining < 20 ? 'warn' : 'good',
    ),
  ])

  const treasuryCard = el('div', { class: 'card' }, [
    el('h3', { text: 'Treasury' }),
    el('div', { class: 'addr', text: data.treasury.address }),
    statRow('SOL balance', formatSol(data.treasury.solLamports)),
    statRow('$SKR balance', formatSkr(Number(data.treasury.skr.atomic))),
    statRow('$SKR ATA', shortAddr(data.treasury.skr.ata)),
  ])

  body.appendChild(signerCard)
  body.appendChild(treasuryCard)
}

// ---- Section: Health ------------------------------------------------------

function cronBadge(ok, label) {
  return el('span', { class: `badge ${ok ? 'ok' : 'bad'}` }, [
    el('span', { class: 'dot' }),
    document.createTextNode(label),
  ])
}

function renderHealth(data) {
  const body = document.getElementById('health-body')
  body.innerHTML = ''

  const cronsCard = el('div', { class: 'card' }, [
    el('h3', { text: 'Crons' }),
    el('div', { class: 'stat' }, [
      el('span', { class: 'label', text: 'Fee recompute (3h)' }),
      cronBadge(data.crons.feeRecompute.lastAttemptOk, formatAgo(data.crons.feeRecompute.lastAttemptAt)),
    ]),
    el('div', { class: 'stat' }, [
      el('span', { class: 'label', text: 'Monitor attempt (6h)' }),
      cronBadge(
        data.crons.jobs?.find((job) => job.job === 'treasury-monitor')?.last_attempt_ok === 1,
        formatAgo(data.crons.treasuryMonitorAndSweep.lastRunAt),
      ),
    ]),
  ])
  for (const job of data.crons.jobs ?? []) {
    cronsCard.appendChild(
      statRow(
        job.job,
        `${formatAgo(job.last_attempt_at)} · ${job.last_attempt_ok === 1 ? 'ok' : job.last_attempt_ok === 0 ? 'failed' : 'running'}`,
        job.last_attempt_ok === 0 ? 'bad' : undefined,
      ),
    )
  }
  cronsCard.appendChild(
    statRow(
      'Discord alerts',
      data.notifications?.discordWebhookConfigured ? 'Configured' : 'Not configured',
      data.notifications?.discordWebhookConfigured ? undefined : 'warn',
    ),
  )
  cronsCard.appendChild(
    statRow(
      'Recorded funding alert level',
      `${data.crons.treasuryMonitorAndSweep.level} · ${formatAgo(data.notifications?.lastAlertStateAt)}`,
    ),
  )

  const stuckCard = el('div', { class: 'card' }, [
    el('h3', { text: 'Needs attention' }),
    statRow(
      'Deferred quick attempts',
      String(data.quickMints.deferredPendingRecovery),
      data.quickMints.deferredPendingRecovery > 0 ? 'warn' : undefined,
    ),
    statRow(
      'Quick mints needing review',
      String(data.quickRecovery?.review ?? data.quickMints.dead),
      (data.quickRecovery?.review ?? data.quickMints.dead) > 0 ? 'bad' : undefined,
    ),
    statRow('Payment unverified', String(data.quickRecovery?.unknown ?? '—')),
    statRow('Payment verified, upload pending', String(data.quickRecovery?.confirmed ?? '—')),
    statRow('Verification rejected', String(data.quickRecovery?.rejected ?? '—')),
    statRow('Stuck roll handoffs', String(data.rolls.stuckHandoffs), data.rolls.stuckHandoffs > 0 ? 'warn' : undefined),
  ])

  const feesCard = el('div', { class: 'card' }, [
    el('h3', { text: 'Current fees' }),
    statRow('Quick mint', formatSol(data.fees.quickFeeLamports)),
    statRow('Roll (12)', formatSol(data.fees.rollFee12Lamports)),
    statRow('Roll (24)', formatSol(data.fees.rollFee24Lamports)),
    statRow('Rent lamports/byte', data.fees.rentLamportsPerByte ?? '—'),
    statRow('Computed', formatAgo(data.fees.computedAt), data.fees.lastGood ? undefined : 'warn'),
  ])

  body.appendChild(cronsCard)
  body.appendChild(stuckCard)
  body.appendChild(feesCard)
}

// ---- Section: Metrics -------------------------------------------------------

let currentWindow = 'all'

function renderMetrics(data) {
  const body = document.getElementById('metrics-body')
  body.innerHTML = ''

  const mintsCard = el('div', { class: 'card' }, [
    el('h3', { text: 'Mints' }),
    statRow('Total', String(data.mints.total)),
    statRow('Quick', String(data.mints.quick)),
    statRow('Roll frames', String(data.mints.roll)),
    statRow('Rolls created', String(data.rolls.created)),
    statRow('Avg frames/roll', data.rolls.avgFramesPerRoll.toFixed(1)),
    statRow('Unique wallets', String(data.uniqueWallets)),
  ])

  const feesCard = el('div', { class: 'card' }, [
    el('h3', { text: 'Fees collected' }),
    statRow('SOL total', formatSol(data.fees.sol.totalLamports)),
    statRow('SOL payments', String(data.fees.sol.count)),
    statRow('$SKR total', formatSkr(data.fees.skr.totalAtomic)),
    statRow('$SKR payments', String(data.fees.skr.count)),
  ])

  body.appendChild(mintsCard)
  body.appendChild(feesCard)

  const charts = document.getElementById('metrics-charts')
  charts.innerHTML = ''

  const quickRollCard = el('div', { class: 'card chart-card' })
  quickRollCard.appendChild(el('h3', { text: 'Quick vs roll' }))
  quickRollCard.appendChild(
    el('div', {
      html: donutChart([
        { value: data.mints.quick, color: CHART_COLORS.quick },
        { value: data.mints.roll, color: CHART_COLORS.roll },
      ]),
    }),
  )
  quickRollCard.appendChild(
    el('div', { class: 'legend' }, [
      el('span', { class: 'item' }, [
        el('span', { class: 'swatch', style: `background:${CHART_COLORS.quick}` }),
        document.createTextNode(`Quick (${data.mints.quick})`),
      ]),
      el('span', { class: 'item' }, [
        el('span', { class: 'swatch', style: `background:${CHART_COLORS.roll}` }),
        document.createTextNode(`Roll (${data.mints.roll})`),
      ]),
    ]),
  )
  charts.appendChild(quickRollCard)

  const paymentCard = el('div', { class: 'card chart-card' })
  paymentCard.appendChild(el('h3', { text: 'SOL vs $SKR' }))
  paymentCard.appendChild(
    el('div', {
      html: donutChart([
        { value: data.paymentSplit.solCount, color: CHART_COLORS.sol },
        { value: data.paymentSplit.skrCount, color: CHART_COLORS.skr },
      ]),
    }),
  )
  paymentCard.appendChild(
    el('div', { class: 'legend' }, [
      el('span', { class: 'item' }, [
        el('span', { class: 'swatch', style: `background:${CHART_COLORS.sol}` }),
        document.createTextNode(`SOL (${data.paymentSplit.solPct}%)`),
      ]),
      el('span', { class: 'item' }, [
        el('span', { class: 'swatch', style: `background:${CHART_COLORS.skr}` }),
        document.createTextNode(`$SKR (${data.paymentSplit.skrPct}%)`),
      ]),
    ]),
  )
  charts.appendChild(paymentCard)

  const overTimeCard = el('div', { class: 'card chart-card', style: 'grid-column: span 2' })
  overTimeCard.appendChild(el('h3', { text: 'Mints over time (30d)' }))
  overTimeCard.appendChild(el('div', { html: barChart(data.mintsOverTime) }))
  overTimeCard.appendChild(
    el('div', { class: 'legend' }, [
      el('span', { class: 'item' }, [
        el('span', { class: 'swatch', style: `background:${CHART_COLORS.quick}` }),
        document.createTextNode('Quick'),
      ]),
      el('span', { class: 'item' }, [
        el('span', { class: 'swatch', style: `background:${CHART_COLORS.roll}` }),
        document.createTextNode('Roll'),
      ]),
    ]),
  )
  charts.appendChild(overTimeCard)
}

// ---- Generic section driver ---------------------------------------------------

/** `path` may be a plain string or a function returning one — the metrics section needs the latter so a window-tab change is picked up on the next refresh. */
function makeSection({ updatedElId, bodyElId, path, render }) {
  const updatedEl = document.getElementById(updatedElId)
  const bodyEl = document.getElementById(bodyElId)
  const resolvePath = () => (typeof path === 'function' ? path() : path)

  async function refresh() {
    try {
      const data = await fetchJson(resolvePath())
      render(data)
      updatedEl.textContent = `updated ${formatAgo(data.generatedAt)}`
      updatedEl.className = 'updated'
    } catch (err) {
      if (err instanceof AuthError) {
        showGate('That token was rejected by the Worker.')
        return
      }
      updatedEl.textContent = `error: ${err.message}`
      updatedEl.className = 'updated error'
      if (!bodyEl.dataset.everLoaded) {
        bodyEl.innerHTML = ''
        bodyEl.appendChild(el('div', { class: 'error-note', text: err.message }))
      }
    }
    bodyEl.dataset.everLoaded = '1'
  }

  return { refresh }
}

// ---- Boot -----------------------------------------------------------------

let refreshHandles = []

function stopPolling() {
  refreshHandles.forEach(clearInterval)
  refreshHandles = []
}

function startDashboard() {
  document.getElementById('gate').hidden = true
  document.getElementById('dashboard').hidden = false
  document.getElementById('token-row').hidden = false

  const wallets = makeSection({
    updatedElId: 'wallets-updated',
    bodyElId: 'wallets-body',
    path: '/ops/dashboard/wallets',
    render: renderWallets,
  })
  const health = makeSection({
    updatedElId: 'health-updated',
    bodyElId: 'health-body',
    path: '/ops/dashboard/health',
    render: renderHealth,
  })
  const metrics = makeSection({
    updatedElId: 'metrics-updated',
    bodyElId: 'metrics-body',
    path: () => `/ops/dashboard/metrics?window=${currentWindow}`,
    render: renderMetrics,
  })

  wallets.refresh()
  health.refresh()
  metrics.refresh()

  stopPolling()
  refreshHandles.push(setInterval(() => wallets.refresh(), REFRESH_FAST_MS))
  refreshHandles.push(setInterval(() => health.refresh(), REFRESH_FAST_MS))
  refreshHandles.push(setInterval(() => metrics.refresh(), REFRESH_SLOW_MS))

  document.querySelectorAll('#window-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentWindow = btn.dataset.window
      document.querySelectorAll('#window-tabs button').forEach((b) => b.classList.toggle('active', b === btn))
      metrics.refresh()
    })
  })
}

function showGate(message) {
  stopPolling()
  document.getElementById('dashboard').hidden = true
  document.getElementById('token-row').hidden = true
  document.getElementById('gate').hidden = false
  document.getElementById('gate-error').textContent = message ?? ''
  document.getElementById('token-input').focus()
}

document.getElementById('gate-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const value = document.getElementById('token-input').value.trim()
  if (!value) return
  setToken(value)
  document.getElementById('gate-error').textContent = ''
  startDashboard()
})

document.getElementById('change-token-btn').addEventListener('click', () => {
  clearToken()
  document.getElementById('token-input').value = ''
  showGate()
})

if (getToken()) {
  startDashboard()
} else {
  showGate()
}
