-- Migration 002: customer_visible_messages view
-- Enforces INC-0304: internal notes NEVER reach customer via SQL-level view

CREATE OR REPLACE VIEW customer_visible_messages AS
SELECT
  id,
  ticket_id,
  author_type,
  author_name,
  body,
  created_at
FROM messages
WHERE visibility = 'public'
