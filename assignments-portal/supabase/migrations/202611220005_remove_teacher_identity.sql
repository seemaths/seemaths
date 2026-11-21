-- Assignment IDs identify progress; ownership stays only in browser management keys.
DROP INDEX IF EXISTS assignments_portal.assignments_teacher;
DROP INDEX IF EXISTS assignments_portal.assignments_teacher_identity;
ALTER TABLE assignments_portal.assignments DROP COLUMN IF EXISTS teacher_hash;
ALTER TABLE assignments_portal.assignments DROP COLUMN IF EXISTS teacher_number;
