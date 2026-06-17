-- Migration 018 — 보충수업(남은 분·사유) 기록. 오늘 화면 입력 → 월말리포트 반영.
-- 워커가 read/put 시 자동 생성도 하지만 기록용으로 남긴다.
--   wrangler d1 execute bakuum-production --remote --file=./migrations/018_supplement.sql

CREATE TABLE IF NOT EXISTS class_supplement (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  date        TEXT NOT NULL DEFAULT '',
  minutes     INTEGER NOT NULL DEFAULT 0,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_class_supplement_student ON class_supplement(student_id);
