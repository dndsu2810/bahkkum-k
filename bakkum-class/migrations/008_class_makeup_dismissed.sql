-- Migration 008 — 사용자가 직접 삭제한 보강(결석)의 삭제 표시(tombstone).
-- 보강 대기를 삭제해도 노션 '기록 가져오기'나 출결 재체크 때 자동으로
-- 되살아나던 문제를 막는다. att_key 하나당 1행. 추가(additive)만 하며
-- 기존 데이터는 안 건드림. 한 번 실행:
--   wrangler d1 execute bakuum-production --remote --file=./migrations/008_class_makeup_dismissed.sql

CREATE TABLE IF NOT EXISTS class_makeup_dismissed (
  att_key  TEXT PRIMARY KEY
);
