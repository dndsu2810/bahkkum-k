-- Migration 002 — Notion integration + bring prod schema up to date.
-- (migration 001 was never applied on prod, so this also adds the richer
--  class_attendance columns the app needs.)
-- All ADD COLUMN are additive/nullable → mogakgong data is untouched.
-- Run once:
--   wrangler d1 execute bakuum-production --remote --file=./migrations/002_notion.sql

-- 1) student academic fields move onto the shared `students` table
ALTER TABLE students ADD COLUMN grade          TEXT DEFAULT '초등';
ALTER TABLE students ADD COLUMN status         TEXT DEFAULT '재원';
ALTER TABLE students ADD COLUMN school         TEXT;
ALTER TABLE students ADD COLUMN birth_date     TEXT;
ALTER TABLE students ADD COLUMN parent_phone   TEXT;
ALTER TABLE students ADD COLUMN student_phone  TEXT;
ALTER TABLE students ADD COLUMN start_date     TEXT;
ALTER TABLE students ADD COLUMN excluded       INTEGER DEFAULT 0;
ALTER TABLE students ADD COLUMN notion_page_id TEXT;

-- 2) richer attendance columns (were in migration 001, never applied on prod)
ALTER TABLE class_attendance ADD COLUMN late_minutes   INTEGER;
ALTER TABLE class_attendance ADD COLUMN attitude       TEXT NOT NULL DEFAULT '';
ALTER TABLE class_attendance ADD COLUMN note           TEXT NOT NULL DEFAULT '';
ALTER TABLE class_attendance ADD COLUMN points_awarded INTEGER NOT NULL DEFAULT 0;

-- 3) carry over the only academic fields the old class_students actually has
--    (grade/start_date/excluded). Matches by roster id; no-op if ids differ.
UPDATE students SET
  grade      = COALESCE((SELECT cs.grade      FROM class_students cs WHERE cs.id = CAST(students.id AS TEXT)), grade),
  start_date = COALESCE((SELECT cs.start_date FROM class_students cs WHERE cs.id = CAST(students.id AS TEXT)), start_date),
  excluded   = COALESCE((SELECT cs.excluded   FROM class_students cs WHERE cs.id = CAST(students.id AS TEXT)), excluded);
