-- Migration 007 — 테스트/평가 기록(테스트 관리). 노션 '수학 테스트' DB와 동일 양식.
-- 월말리포트 '평가 결과'에 누적. 추가(additive)만 하며 기존 데이터는 안 건드림. 한 번 실행:
--   wrangler d1 execute bakuum-production --remote --file=./migrations/007_class_tests.sql

CREATE TABLE IF NOT EXISTS class_tests (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  date        TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT '',
  round       TEXT NOT NULL DEFAULT '',
  range_      TEXT NOT NULL DEFAULT '',
  score       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT '예정',
  memo        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_tests_student ON class_tests(student_id);
