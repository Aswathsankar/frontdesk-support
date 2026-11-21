-- Migration 005: seed sla_config table
INSERT INTO sla_config (priority, first_reply_min, resolution_min) VALUES
  ('urgent', 120, NULL),    -- resolution = "end of same working day" = special logic
  ('medium', 270, 1620),
  ('low',    540, 2700)
ON DUPLICATE KEY UPDATE
  first_reply_min = VALUES(first_reply_min),
  resolution_min  = VALUES(resolution_min)
