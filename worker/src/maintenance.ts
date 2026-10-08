/**
 * Production maintenance is a spending/minting circuit breaker, not a
 * deployment label. Keep the policy in one small module so HTTP, Queue and
 * Cron entry points all use the same explicit switch.
 */
export function isMaintenanceMode(env: { MAINTENANCE_MODE?: string }): boolean {
  return env.MAINTENANCE_MODE === 'true'
}

/**
 * Routes that can write mint/payment state, upload user bytes, enqueue paid
 * work, send a transaction, or notify an external service. Read-only status,
 * recovery inspection and catalogue delivery remain available.
 *
 * Fee recomputation is intentionally allowed: it updates only the fee cache
 * and is required for the owner-side readiness check while paid mutations are
 * still paused.
 */
const BLOCKED_HTTP_ROUTE_KINDS = new Set([
  'ops-test-alert',
  'ops-sweep-quick-mints',
  'create-roll',
  'mint-frame',
  'authorize-roll',
  'complete-roll',
  'stage-quick',
  'finalize-quick',
  'release-quick',
  'skr-quote',
])

export function isHttpRouteBlockedByMaintenance(routeKind: string): boolean {
  return BLOCKED_HTTP_ROUTE_KINDS.has(routeKind)
}

export const MAINTENANCE_RETRY_AFTER_SECONDS = 300
export const MAINTENANCE_QUEUE_RETRY_SECONDS = 900
