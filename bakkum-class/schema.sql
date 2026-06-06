-- 바꿈영수학원 수업 관리 — D1 schema
-- IMPORTANT: lives INSIDE the shared `bakuum-production` D1 (모각공/마법거울 라이브 DB).
-- All tables are prefixed `class_` so they NEVER collide with the existing
-- mogakgong tables (students, student_schedules, attendance_log_v2, ...).
-- Every statement is additive (CREATE TABLE IF NOT EXISTS) — applying this file
-- does not touch or read any existing mogakgong data.

CREATE TABLE IF NOT EXISTS class_students (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  grade         TEXT NOT NULL,              -- '초등' | '중등'
  start_date    TEXT NOT NULL,             -- YYYY-MM-DD
  excluded      INTEGER NOT NULL DEFAULT 0, -- 원장 내부 메모 플래그
  status        TEXT NOT NULL DEFAULT '재원', -- 재원|휴원|퇴원|대기
  school        TEXT NOT NULL DEFAULT '',
  birthdate     TEXT NOT NULL DEFAULT '',   -- YYYY-MM-DD
  parent_phone  TEXT NOT NULL DEFAULT '',
  student_phone TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);

-- Each regular weekly lesson slot for a student.
CREATE TABLE IF NOT EXISTS class_lessons (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  day         TEXT NOT NULL,              -- '월'..'일'
  time        TEXT NOT NULL,             -- HH:MM
  duration    INTEGER NOT NULL,          -- minutes
  sort_order  INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (student_id) REFERENCES class_students(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_class_lessons_student ON class_lessons(student_id);

-- Student class attendance. key = "YYYY-MM-DD|studentId|HH:MM"
CREATE TABLE IF NOT EXISTS class_attendance (
  att_key         TEXT PRIMARY KEY,
  status          TEXT NOT NULL,            -- 출석|지각|결석|조퇴|무단결석|보강
  late_minutes    INTEGER,                  -- 지각 시 분
  attitude        TEXT NOT NULL DEFAULT '', -- 매우좋음|보통|미흡|''
  note            TEXT NOT NULL DEFAULT '', -- 특이사항
  points_awarded  INTEGER NOT NULL DEFAULT 0 -- 출석 +20 적립 여부(멱등)
);

CREATE TABLE IF NOT EXISTS class_makeups (
  id                TEXT PRIMARY KEY,
  student_id        TEXT NOT NULL,
  absent_date       TEXT NOT NULL DEFAULT '',
  absent_time       TEXT NOT NULL DEFAULT '',
  absent_duration   INTEGER NOT NULL DEFAULT 0,
  att_key           TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL,        -- 'pending' | 'scheduled' | 'skip'
  makeup_date       TEXT NOT NULL DEFAULT '',
  makeup_time       TEXT NOT NULL DEFAULT '',
  makeup_duration   INTEGER NOT NULL DEFAULT 0,
  parent_contacted  INTEGER NOT NULL DEFAULT 0,
  memo              TEXT NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL,
  FOREIGN KEY (student_id) REFERENCES class_students(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_class_makeups_student ON class_makeups(student_id);
CREATE INDEX IF NOT EXISTS idx_class_makeups_status ON class_makeups(status);
