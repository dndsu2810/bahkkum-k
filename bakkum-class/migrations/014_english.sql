-- 영어(신규) — 일일 학습일지 · 진도 · 테스트 · 월말리포트. 앱 자체 저장(노션 X).
-- 워커가 ensureEngTables로 자가 생성. 명시적 마이그레이션 보관용.
CREATE TABLE IF NOT EXISTS class_eng_daily (
  student_id TEXT NOT NULL, date TEXT NOT NULL, attended INTEGER NOT NULL DEFAULT 0,
  goals TEXT NOT NULL DEFAULT '[]', homework TEXT NOT NULL DEFAULT '', hw_checked INTEGER NOT NULL DEFAULT 0,
  comment TEXT NOT NULL DEFAULT '', materials TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(student_id, date)
);
CREATE TABLE IF NOT EXISTS class_eng_progress (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL, book TEXT NOT NULL DEFAULT '', level TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '진행', start_date TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS class_eng_test (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL, date TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 100, memo TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS class_eng_report (
  student_id TEXT NOT NULL, month TEXT NOT NULL, teacher TEXT NOT NULL DEFAULT '',
  scores TEXT NOT NULL DEFAULT '{}', comments TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(student_id, month)
);
