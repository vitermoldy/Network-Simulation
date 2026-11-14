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
    client_id CHAR(12) NOT NULL,
    host VARCHAR(253) NOT NULL,
    source VARCHAR(32) NOT NULL,
    scenario VARCHAR(16) NOT NULL,
    loss_rate DECIMAL(4,2) NOT NULL DEFAULT 0,
    status ENUM('done','failed') NOT NULL,
    failed_phase VARCHAR(16) NULL,
    reason VARCHAR(400) NULL,
    sim_seconds DECIMAL(7,1) NOT NULL,
    packets_lost INT NOT NULL,
