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
