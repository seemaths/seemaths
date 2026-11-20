ALTER TABLE assignments_portal.participants
 ADD COLUMN IF NOT EXISTS active_seconds INTEGER NOT NULL DEFAULT 0
 CHECK (active_seconds BETWEEN 0 AND 604800);
