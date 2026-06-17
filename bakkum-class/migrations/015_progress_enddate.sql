-- Migration 015 — 진도·교재관리 개편: 교재 '완료일'(end_date) 추가.
-- 수학 진도를 교재 단위로 관리(시작일 입력 → 완료 전까지 '진행중' → 완료하면 '교재 완료').
-- 월말리포트에서 '해당 월에 완료한 교재'를 집계하려면 완료 시점이 필요해 컬럼을 추가한다.
-- Additive. Run once:
--   wrangler d1 execute bakuum-production --remote --file=./migrations/015_progress_enddate.sql

ALTER TABLE class_progress ADD COLUMN end_date TEXT NOT NULL DEFAULT '';
