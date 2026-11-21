-- Migration 003b: Prevent DELETE on audit_events
CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
FOR EACH ROW
SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'audit_events rows are immutable: DELETE forbidden'
