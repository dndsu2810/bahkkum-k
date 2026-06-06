-- Migration 003 — remove the foreign key on class_lessons / class_makeups.
-- They referenced class_students(id), but the student roster now lives in the
-- shared `students` table, so inserting a lesson/makeup with a roster id failed
-- the FK (foreign_keys=ON) → PUT 500 → edits silently lost on refresh.
-- SQLite can't drop a constraint in place, so recreate the tables (data preserved).
-- Run once:
--   wrangler d1 execute bakuum-production --remote --file=./migrations/003_drop_class_fk.sql

DROP TABLE IF EXISTS class_lessons_new;
CREATE TABLE class_lessons_new (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  day         TEXT NOT NULL,
  time        TEXT NOT NULL,
  duration    INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO class_lessons_new (id,student_id,day,time,duration,sort_order)
  SELECT id,student_id,day,time,duration,sort_order FROM class_lessons;
DROP TABLE class_lessons;
ALTER TABLE class_lessons_new RENAME TO class_lessons;
CREATE INDEX IF NOT EXISTS idx_class_lessons_student ON class_lessons(student_id);

DROP TABLE IF EXISTS class_makeups_new;
CREATE TABLE class_makeups_new (
  id                TEXT PRIMARY KEY,
  student_id        TEXT NOT NULL,
  absent_date       TEXT NOT NULL DEFAULT '',
  absent_time       TEXT NOT NULL DEFAULT '',
  absent_duration   INTEGER NOT NULL DEFAULT 0,
  att_key           TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL,
  makeup_date       TEXT NOT NULL DEFAULT '',
  makeup_time       TEXT NOT NULL DEFAULT '',
  makeup_duration   INTEGER NOT NULL DEFAULT 0,
  parent_contacted  INTEGER NOT NULL DEFAULT 0,
  memo              TEXT NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL
);
INSERT INTO class_makeups_new
  SELECT id,student_id,absent_date,absent_time,absent_duration,att_key,status,makeup_date,makeup_time,makeup_duration,parent_contacted,memo,created_at FROM class_makeups;
DROP TABLE class_makeups;
ALTER TABLE class_makeups_new RENAME TO class_makeups;
CREATE INDEX IF NOT EXISTS idx_class_makeups_student ON class_makeups(student_id);
CREATE INDEX IF NOT EXISTS idx_class_makeups_status ON class_makeups(status);
