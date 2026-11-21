-- Migration 003c: Prevent UPDATE on messages (INC-0318: sent reply must not be editable)
CREATE TRIGGER messages_no_update
BEFORE UPDATE ON messages
FOR EACH ROW
SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'messages rows are immutable: UPDATE forbidden'
