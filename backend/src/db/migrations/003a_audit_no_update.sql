-- Migration 003: immutability triggers for audit_events (INC-0318)
-- Each trigger is a separate statement so the runner can execute them
-- without DELIMITER hacks (runner splits on ";\n\n" or uses query-per-block)

-- Prevent UPDATE on audit_events
CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
FOR EACH ROW
SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'audit_events rows are immutable: UPDATE forbidden'
