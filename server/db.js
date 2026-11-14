import mysql from 'mysql2/promise'

/**
 * Three tables:
 * - clients: one row per browser, keyed by its 12-character code;
 * - runs: every finished request (sent or failed) with what happened on the way;
 * - layouts: saved network designs (devices, cables, IP settings) as one JSON text each.
 * Times are stored in UTC.
 */
const TABLES = [
  `CREATE TABLE IF NOT EXISTS clients (
    id CHAR(12) PRIMARY KEY,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS runs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
