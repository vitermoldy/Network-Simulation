import mysql from 'mysql2/promise'

/**
 * Three tables:
 * - clients: one row per browser, keyed by its 12-character code;
 * - runs: every finished request (sent or failed) with what happened on the way;
 * - layouts: saved network designs (devices, cables, IP settings) as one JSON text each.
