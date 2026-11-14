import express from 'express'

/**
 * The API:
 *   GET    /api/health
 *   POST   /api/runs                 { client, run }        store one finished request
 *   GET    /api/runs/:client                                the latest 50 runs, newest first
 *   GET    /api/layouts/:client                             saved network designs, newest first
 *   GET    /api/layouts/:client/:id                         one design with its JSON
 *   PUT    /api/layouts              { client, name, data } save a design (same name replaces it)
 *   DELETE /api/layouts/:client/:id
 * There are no accounts: a client is the 12-character code its browser made up. Anyone who
 * knows a code can read and change that client's data, so the code never appears on screen.
 */

const CODE = /^[A-HJ-NP-Z2-9]{12}$/
// ping and lookup are runs started from a Command Prompt or CLI rather than a web scenario.
const SCENARIOS = new Set(['normal', 'loss', 'router-down', 'bad-domain', 'ping', 'lookup'])
const PHASES = new Set(['input', 'arp', 'dns', 'tcp-open', 'http-req', 'http-res', 'output', 'tcp-close', 'icmp'])
const MAX_LAYOUT = 512 * 1024

/** Writes come as JSON from this site only: no form posts, no other origin. */
function sameOriginWrites(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  if (req.method !== 'DELETE' && !req.is('application/json')) return res.status(415).json({ error: 'Kirim data sebagai JSON.' })
  const origin = req.headers.origin
  if (origin && req.headers.host && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Asal permintaan tidak dikenal.' })
  next()
}

/** At most `limit` writes per minute per address. */
function rateLimit(limit) {
  const hits = new Map()
  return (req, res, next) => {
    if (req.method === 'GET') return next()
    const now = Date.now()
    const key = req.ip ?? 'unknown'
    const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000)
    recent.push(now)
    hits.set(key, recent)
    if (hits.size > 5000) hits.clear()
    if (recent.length > limit) return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar lagi.' })
    next()
  }
