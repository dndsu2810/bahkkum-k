-- Migration 004 — homework/progress record tables (숙제 관리 / 진도 관리).
-- These accumulate per student/date and feed the monthly report (like attendance).
-- No FK (roster lives in `students`). Additive. Run once:
--   wrangler d1 execute bakuum-production --remote --file=./migrations/004_homework_progress.sql

CREATE TABLE IF NOT EXISTS class_homework (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  date        TEXT NOT NULL,
  book        TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '',
  completion  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'done',
  memo        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_homework_student ON class_homework(student_id);

CREATE TABLE IF NOT EXISTS class_progress (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  date        TEXT NOT NULL,
  unit        TEXT NOT NULL DEFAULT '',
  area        TEXT NOT NULL DEFAULT '',
  pct         INTEGER NOT NULL DEFAULT 0,
  start_date  TEXT NOT NULL DEFAULT '',
  memo        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_progress_student ON class_progress(student_id);
