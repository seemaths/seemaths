-- Run once in the dedicated SeeMaths Supabase project (SQL Editor/migrations).
-- This schema is deliberately outside the default public PostgREST API.
CREATE SCHEMA IF NOT EXISTS assignments_portal;
REVOKE ALL ON SCHEMA assignments_portal FROM PUBLIC, anon, authenticated;
SET search_path TO assignments_portal;
CREATE TABLE IF NOT EXISTS assignments (
 id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE,
 management_hash TEXT NOT NULL, recipe TEXT NOT NULL,
 created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
 closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0,1)),
 next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number BETWEEN 1 AND 101)
);
CREATE INDEX IF NOT EXISTS assignments_expiry ON assignments(expires_at);
CREATE TABLE IF NOT EXISTS participants (
 id TEXT PRIMARY KEY,
 assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
 number INTEGER NOT NULL, credential_hash TEXT NOT NULL,
 join_hash TEXT NOT NULL, started_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL, completed_at BIGINT,
 revision INTEGER NOT NULL DEFAULT 0,
 answers TEXT NOT NULL DEFAULT '[]', attempt_id TEXT,
 UNIQUE(assignment_id,number), UNIQUE(assignment_id,join_hash)
);
CREATE INDEX IF NOT EXISTS participants_assignment ON participants(assignment_id);
CREATE TABLE IF NOT EXISTS rate_buckets (
 bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_expiry ON rate_buckets(expires_at);

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA assignments_portal FROM PUBLIC, anon, authenticated;
RESET search_path;
