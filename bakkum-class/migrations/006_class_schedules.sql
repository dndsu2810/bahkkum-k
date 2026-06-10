-- Migration 006 — 시간표 변경 이력(적용 시작일별 버전).
-- 시간표가 바뀌면 적용 시작일과 함께 새 버전을 쌓고, 과거 날짜 출결은
-- 그 시점에 유효했던 시간표로 표시한다. 한 학생당 1행(versions = JSON 배열).
-- 추가(additive)만 하며 기존 데이터는 건드리지 않음. 한 번 실행:
--   wrangler d1 execute bakuum-production --remote --file=./migrations/006_class_schedules.sql

CREATE TABLE IF NOT EXISTS class_schedules (
  student_id  TEXT PRIMARY KEY,
  versions    TEXT NOT NULL DEFAULT '[]'
);
