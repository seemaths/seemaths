-- Teacher labels live only as long as their seven-day assignment records.
ALTER TABLE assignments_portal.assignments ADD COLUMN IF NOT EXISTS teacher_hash TEXT;
ALTER TABLE assignments_portal.assignments ADD COLUMN IF NOT EXISTS teacher_number TEXT;
CREATE INDEX IF NOT EXISTS assignments_teacher ON assignments_portal.assignments(teacher_number);
CREATE INDEX IF NOT EXISTS assignments_teacher_identity ON assignments_portal.assignments(teacher_hash);
