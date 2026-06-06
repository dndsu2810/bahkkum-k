-- Migration 001 — adds the new student fields + richer attendance columns to
-- an EXISTING bakuum-production install (class_* tables already created by schema.sql).
-- Run once: wrangler d1 execute bakuum-production --remote --file=./migrations/001_extend.sql
-- (SQLite has no ADD COLUMN IF NOT EXISTS — run exactly once.)
-- Only touches class_* tables; mogakgong tables are untouched.

ALTER TABLE class_students ADD COLUMN status        TEXT NOT NULL DEFAULT '재원';
ALTER TABLE class_students ADD COLUMN school        TEXT NOT NULL DEFAULT '';
ALTER TABLE class_students ADD COLUMN birthdate     TEXT NOT NULL DEFAULT '';
ALTER TABLE class_students ADD COLUMN parent_phone  TEXT NOT NULL DEFAULT '';
ALTER TABLE class_students ADD COLUMN student_phone TEXT NOT NULL DEFAULT '';

ALTER TABLE class_attendance ADD COLUMN late_minutes   INTEGER;
ALTER TABLE class_attendance ADD COLUMN attitude       TEXT NOT NULL DEFAULT '';
ALTER TABLE class_attendance ADD COLUMN note           TEXT NOT NULL DEFAULT '';
ALTER TABLE class_attendance ADD COLUMN points_awarded INTEGER NOT NULL DEFAULT 0;

-- Normalize any legacy attendance values from the old present/absent model.
UPDATE class_attendance SET status = '출석' WHERE status = 'present';
UPDATE class_attendance SET status = '결석' WHERE status = 'absent';
