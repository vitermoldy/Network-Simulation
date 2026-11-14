import mysql from 'mysql2/promise'

/**
 * Three tables:
 * - clients: one row per browser, keyed by its 12-character code;
