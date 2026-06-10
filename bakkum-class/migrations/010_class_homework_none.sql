-- Migration 010 — '오늘 숙제 없음'으로 정리한 표식(tombstone).
-- 오늘 페이지의 '숙제 없음' 버튼: 새 숙제 기록을 만들지 않고 '내줄 숙제 정리 완료'만
-- 기억한다. mark_key 하나당 1행 (key = "studentId|YYYY-MM-DD"). 추가(additive)만 하며
-- 기존 데이터는 안 건드림. 한 번 실행:
--   wrangler d1 execute bakuum-production --remote --file=./migrations/010_class_homework_none.sql

CREATE TABLE IF NOT EXISTS class_homework_none (
  mark_key  TEXT PRIMARY KEY
);
