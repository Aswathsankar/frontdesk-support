-- Migration 003d: Prevent DELETE on messages
CREATE TRIGGER messages_no_delete
BEFORE DELETE ON messages
FOR EACH ROW
SIGNAL SQLSTATE '45000'
SET MESSAGE_TEXT = 'messages rows are immutable: DELETE forbidden'
