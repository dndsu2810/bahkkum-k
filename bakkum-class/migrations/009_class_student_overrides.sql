-- Migration 009 — 앱에서 인라인 수정한 '앱 소유' 학생 필드 목록.
-- 학생 관리 표에서 이름/학교/구분/상태를 바로 고치면 그 필드를 여기에 기록하고,
-- 노션 동기화가 해당 필드는 노션 값으로 덮어쓰지 않는다(명단=노션 원본, 앱 수정분 보존).
-- 추가(additive)만 하며 기존 데이터는 안 건드림. 한 번 실행:
--   wrangler d1 execute bakuum-production --remote --file=./migrations/009_class_student_overrides.sql

CREATE TABLE IF NOT EXISTS class_student_overrides (
  student_id  TEXT PRIMARY KEY,
  fields      TEXT NOT NULL DEFAULT '[]'
);
