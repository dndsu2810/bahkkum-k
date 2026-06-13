-- 허브 공유 영역 (특이사항·위키·SNS). class_tasks는 기존(006~) 재사용.
-- 워커가 ensureHubTables로 자가 생성. 명시적 마이그레이션 보관용.
CREATE TABLE IF NOT EXISTS class_notes (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS class_wiki (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
  importance INTEGER NOT NULL DEFAULT 2, status TEXT NOT NULL DEFAULT 'draft',
  updated_by TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS class_sns (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT '', author_id TEXT NOT NULL DEFAULT '', author_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'wait', link TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
);
