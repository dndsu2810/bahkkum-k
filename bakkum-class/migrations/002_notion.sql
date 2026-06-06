-- Migration 002 — Notion integration.
-- Moves the student academic fields onto the shared `students` table (additive,
-- nullable columns → mogakgong's existing data is untouched) and adds
-- notion_page_id for two-way Notion sync. Run once.
--   wrangler d1 execute bakuum-production --remote --file=./migrations/002_notion.sql
-- (SQLite has no ADD COLUMN IF NOT EXISTS — run exactly once.)

ALTER TABLE students ADD COLUMN grade         TEXT DEFAULT '초등';
ALTER TABLE students ADD COLUMN status        TEXT DEFAULT '재원';
ALTER TABLE students ADD COLUMN school        TEXT;
ALTER TABLE students ADD COLUMN birth_date    TEXT;
ALTER TABLE students ADD COLUMN parent_phone  TEXT;
ALTER TABLE students ADD COLUMN student_phone TEXT;
ALTER TABLE students ADD COLUMN start_date    TEXT;
ALTER TABLE students ADD COLUMN excluded      INTEGER DEFAULT 0;
ALTER TABLE students ADD COLUMN notion_page_id TEXT;

-- Carry over any academic data previously entered in class_students
-- (class_students.id is the roster id as TEXT; birthdate -> birth_date).
UPDATE students SET
  grade         = COALESCE((SELECT cs.grade         FROM class_students cs WHERE cs.id = CAST(students.id AS TEXT)), grade),
  status        = COALESCE((SELECT cs.status        FROM class_students cs WHERE cs.id = CAST(students.id AS TEXT)), status),
  school        = COALESCE((SELECT cs.school        FROM class_students cs WHERE cs.id = CAST(students.id AS TEXT)), school),
  birth_date    = COALESCE((SELECT cs.birthdate     FROM class_students cs WHERE cs.id = CAST(students.id AS TEXT)), birth_date),
  parent_phone  = COALESCE((SELECT cs.parent_phone  FROM class_students cs WHERE cs.id = CAST(students.id AS TEXT)), parent_phone),
  student_phone = COALESCE((SELECT cs.student_phone FROM class_students cs WHERE cs.id = CAST(students.id AS TEXT)), student_phone),
  start_date    = COALESCE((SELECT cs.start_date    FROM class_students cs WHERE cs.id = CAST(students.id AS TEXT)), start_date),
  excluded      = COALESCE((SELECT cs.excluded      FROM class_students cs WHERE cs.id = CAST(students.id AS TEXT)), excluded);
