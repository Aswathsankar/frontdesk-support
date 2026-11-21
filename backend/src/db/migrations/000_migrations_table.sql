-- Migration 004: migrations tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   VARCHAR(255) PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
