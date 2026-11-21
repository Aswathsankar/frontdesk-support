-- Migration 001: core tables
-- Run via migration runner (no DELIMITER; triggers in separate files)

CREATE TABLE IF NOT EXISTS agents (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS holidays (
  id    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  date  DATE NOT NULL UNIQUE,
  name  VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tickets (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_ref       CHAR(36) NOT NULL UNIQUE,  -- UUID for public URLs
  customer_email     VARCHAR(255) NOT NULL,
  subject            VARCHAR(500) NOT NULL,
  priority           ENUM('urgent','medium','low') NOT NULL DEFAULT 'medium',
  status             ENUM('new','open','waiting_on_customer','resolved','closed') NOT NULL DEFAULT 'new',
  assignee_id        INT UNSIGNED NULL,
  version            INT UNSIGNED NOT NULL DEFAULT 0,  -- optimistic lock
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  first_response_at  DATETIME(3) NULL,
  resolved_at        DATETIME(3) NULL,
  closed_at          DATETIME(3) NULL,
  response_due_at    DATETIME(3) NULL,   -- computed on creation
  resolution_due_at  DATETIME(3) NULL,   -- computed on creation
  close_reason       ENUM('resolved','auto_closed_no_reply') NULL,
  related_ticket_id  INT UNSIGNED NULL,
  FOREIGN KEY (assignee_id) REFERENCES agents(id) ON DELETE SET NULL,
  FOREIGN KEY (related_ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,
  INDEX idx_status (status),
  INDEX idx_assignee (assignee_id),
  INDEX idx_customer_ref (customer_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id   INT UNSIGNED NOT NULL,
  author_type ENUM('agent','customer','system') NOT NULL,
  author_id   INT UNSIGNED NULL,         -- agent id or NULL for customer/system
  author_name VARCHAR(100) NULL,         -- denormalized: customer email or agent name
  body        TEXT NOT NULL,
  visibility  ENUM('public','internal') NOT NULL DEFAULT 'public',
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  INDEX idx_ticket (ticket_id),
  INDEX idx_visibility (visibility)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sla_pauses (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id   INT UNSIGNED NOT NULL,
  paused_at   DATETIME(3) NOT NULL,
  resumed_at  DATETIME(3) NULL,          -- NULL = currently paused
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  INDEX idx_ticket (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_events (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id   INT UNSIGNED NOT NULL,
  event_type  VARCHAR(50) NOT NULL,
  actor_type  ENUM('agent','customer','system') NOT NULL,
  actor_id    INT UNSIGNED NULL,
  payload     JSON NOT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  prev_hash   CHAR(64) NULL,            -- sha256 hex of previous event
  hash        CHAR(64) NOT NULL,         -- sha256(prev_hash + canonical JSON)
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  INDEX idx_ticket (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sla_config (
  priority          ENUM('urgent','medium','low') PRIMARY KEY,
  first_reply_min   INT UNSIGNED NOT NULL,
  resolution_min    INT UNSIGNED NULL    -- NULL = "same day" logic for urgent
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
