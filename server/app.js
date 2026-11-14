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
}

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
const count = (v) => (Number.isInteger(v) && v >= 0 && v < 1e6 ? v : 0)

/** Checks a run from the browser; returns the row values or a reason. */
function cleanRun(run) {
  if (!run || typeof run !== 'object') return { error: 'Data percobaan kosong.' }
  const host = text(run.host, 253).toLowerCase()
  if (!/^[a-z0-9.-]+$/.test(host)) return { error: 'Alamat web tidak sah.' }
  if (run.status !== 'done' && run.status !== 'failed') return { error: 'Status percobaan tidak dikenal.' }
  const at = new Date(run.finishedAt)
  if (Number.isNaN(at.getTime()) || Math.abs(Date.now() - at.getTime()) > 400 * 86_400_000) return { error: 'Waktu percobaan tidak masuk akal.' }
  const path = Array.isArray(run.path) ? run.path.slice(0, 40).map((p) => text(p, 32)) : []
  return {
    row: [
      host,
      text(run.source, 32) || '-',
      SCENARIOS.has(run.scenario) ? run.scenario : 'normal',
      Math.min(0.99, Math.max(0, Number(run.lossRate) || 0)),
      run.status,
      PHASES.has(run.failedPhase) ? run.failedPhase : null,
      run.reason ? text(run.reason, 400) : null,
      Math.min(99999, Math.max(0, Number(run.simSeconds) || 0)),
      count(run.packetsLost),
      count(run.resends),
      count(run.routeChanges),
      JSON.stringify(path),
      count(run.devices),
      at,
    ],
  }
}

/** The pool appears once MySQL answers; until then the API says so instead of hanging. */
export function createApi(getPool, database) {
  const api = express.Router()
  api.use(express.json({ limit: MAX_LAYOUT + 64 * 1024 }))
  api.use(sameOriginWrites)
  api.use(rateLimit(120))
  api.get('/health', (_req, res) => res.status(getPool() ? 200 : 503).json({ ok: !!getPool(), database }))
  api.use((req, res, next) => (getPool() ? next() : res.status(503).json({ error: 'Database belum terhubung.' })))

  const touch = (client) => getPool().query('INSERT INTO clients (id) VALUES (?) ON DUPLICATE KEY UPDATE last_seen = CURRENT_TIMESTAMP', [client])
  const codeOf = (raw) => (CODE.test(String(raw ?? '')) ? String(raw) : null)

  api.post('/runs', async (req, res) => {
    const client = codeOf(req.body?.client)
    if (!client) return res.status(400).json({ error: 'Kode klien tidak dikenal.' })
    const { row, error } = cleanRun(req.body?.run)
    if (error) return res.status(400).json({ error })
    await touch(client)
    const [r] = await getPool().query(
      `INSERT INTO runs (client_id, host, source, scenario, loss_rate, status, failed_phase, reason, sim_seconds,
        packets_lost, resends, route_changes, path, devices, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client, ...row],
    )
    res.json({ ok: true, id: r.insertId })
  })

  api.get('/runs/:client', async (req, res) => {
    const client = codeOf(req.params.client)
    if (!client) return res.status(400).json({ error: 'Kode klien tidak dikenal.' })
    const [rows] = await getPool().query(
      `SELECT id, host, source, scenario, loss_rate AS lossRate, status, failed_phase AS failedPhase, reason,
        sim_seconds AS simSeconds, packets_lost AS packetsLost, resends, route_changes AS routeChanges, path, devices,
        finished_at AS finishedAt FROM runs WHERE client_id = ? ORDER BY finished_at DESC, id DESC LIMIT 50`,
      [client],
    )
    res.json({
      runs: rows.map((r) => ({
        ...r,
        lossRate: Number(r.lossRate),
        simSeconds: Number(r.simSeconds),
        path: typeof r.path === 'string' ? JSON.parse(r.path) : (r.path ?? []),
      })),
    })
  })

  api.get('/layouts/:client', async (req, res) => {
    const client = codeOf(req.params.client)
    if (!client) return res.status(400).json({ error: 'Kode klien tidak dikenal.' })
    const [rows] = await getPool().query(
      'SELECT id, name, devices, links, updated_at AS updatedAt FROM layouts WHERE client_id = ? ORDER BY updated_at DESC, id DESC',
      [client],
    )
    res.json({ layouts: rows })
  })

  api.get('/layouts/:client/:id', async (req, res) => {
    const client = codeOf(req.params.client)
    if (!client) return res.status(400).json({ error: 'Kode klien tidak dikenal.' })
    const [rows] = await getPool().query('SELECT name, data FROM layouts WHERE client_id = ? AND id = ?', [client, Number(req.params.id) || 0])
    if (!rows[0]) return res.status(404).json({ error: 'Rancangan tidak ditemukan.' })
    res.json(rows[0])
  })

  api.put('/layouts', async (req, res) => {
    const client = codeOf(req.body?.client)
    if (!client) return res.status(400).json({ error: 'Kode klien tidak dikenal.' })
    const name = text(req.body?.name, 60).trim().replace(/\s+/g, ' ')
    if (!name) return res.status(400).json({ error: 'Beri nama rancangannya dulu.' })
    const data = req.body?.data
    if (typeof data !== 'string' || Buffer.byteLength(data) > MAX_LAYOUT) return res.status(413).json({ error: 'Rancangan terlalu besar.' })
    let parsed
    try {
      parsed = JSON.parse(data)
    } catch {
      return res.status(400).json({ error: 'Rancangan bukan JSON.' })
    }
    if (parsed?.version !== 1 || !Array.isArray(parsed.devices) || !Array.isArray(parsed.links)) return res.status(400).json({ error: 'Isi rancangan tidak dikenali.' })
    await touch(client)
    await getPool().query(
      `INSERT INTO layouts (client_id, name, data, devices, links, updated_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE data = VALUES(data), devices = VALUES(devices), links = VALUES(links), updated_at = VALUES(updated_at)`,
      [client, name, data, parsed.devices.length, parsed.links.length],
    )
    res.json({ ok: true })
  })

  api.delete('/layouts/:client/:id', async (req, res) => {
    const client = codeOf(req.params.client)
    if (!client) return res.status(400).json({ error: 'Kode klien tidak dikenal.' })
    await getPool().query('DELETE FROM layouts WHERE client_id = ? AND id = ?', [client, Number(req.params.id) || 0])
    res.json({ ok: true })
  })

  api.use((err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Kiriman terlalu besar.' })
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON tidak terbaca.' })
    console.error(err)
