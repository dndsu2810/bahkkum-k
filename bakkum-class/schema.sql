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
-- student_id references the shared `students` roster id (no FK — roster lives
-- in a different table and ids are managed by the app/Notion sync).
CREATE TABLE IF NOT EXISTS class_lessons (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  day         TEXT NOT NULL,              -- '월'..'일'
  time        TEXT NOT NULL,             -- HH:MM
  duration    INTEGER NOT NULL,          -- minutes
  sort_order  INTEGER NOT NULL DEFAULT 0
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
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_makeups_student ON class_makeups(student_id);
CREATE INDEX IF NOT EXISTS idx_class_makeups_status ON class_makeups(status);

-- 숙제 기록 (숙제 관리 페이지 → 월말리포트 누적). student_id = 로스터 id (no FK).
CREATE TABLE IF NOT EXISTS class_homework (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  date        TEXT NOT NULL,
  book        TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '',   -- comma-separated
  completion  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'done', -- done | late
  memo        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_homework_student ON class_homework(student_id);

-- 진도 기록 (진도 관리 페이지 → 월말리포트 누적). student_id = 로스터 id (no FK).
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

-- Shared roster + points tables. On bakuum-production these already exist
-- (mogakgong) — IF NOT EXISTS is a no-op there. Defined here so local dev and
-- fresh installs have them, including the academic columns (see migrations/002).
CREATE TABLE IF NOT EXISTS students (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE,
  photo_url      TEXT,
  points         INTEGER DEFAULT 0,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  grade          TEXT DEFAULT '초등',
  status         TEXT DEFAULT '재원',
  school         TEXT,
  birth_date     TEXT,
  parent_phone   TEXT,
  student_phone  TEXT,
  start_date     TEXT,
  excluded       INTEGER DEFAULT 0,
  notion_page_id TEXT
);
CREATE TABLE IF NOT EXISTS point_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'learn',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
