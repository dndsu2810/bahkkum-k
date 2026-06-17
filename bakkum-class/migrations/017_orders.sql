-- Migration 017 — 교재·비품 주문 관리.
-- 강사 신청 → 원장 구매 → 배송 → 배부(교재)/비치(비품). 추가전용. 워커가 부팅 시 자동 생성도 함.
--   wrangler d1 execute bakuum-production --remote --file=./migrations/017_orders.sql

CREATE TABLE IF NOT EXISTS class_order (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL DEFAULT '교재',  -- 교재 | 비품
  name            TEXT NOT NULL DEFAULT '',       -- 품목명
  requester       TEXT NOT NULL DEFAULT '',       -- 신청자 이름
  requester_sub   TEXT NOT NULL DEFAULT '',
  need_by         TEXT NOT NULL DEFAULT '',       -- 필요한 날짜(기한)
  student_ids     TEXT NOT NULL DEFAULT '[]',     -- 교재 대상 학생(JSON)
  qty             INTEGER NOT NULL DEFAULT 0,      -- 비품 수량
  link            TEXT NOT NULL DEFAULT '',       -- 비품 구매 링크
  reason          TEXT NOT NULL DEFAULT '',       -- 비품 구매 사유
  for_class       TEXT NOT NULL DEFAULT '',       -- 비품 필요 수업
  place           TEXT NOT NULL DEFAULT '',       -- 비품 비치 위치
  purchased       INTEGER NOT NULL DEFAULT 0,      -- 구매완료
  shipped         INTEGER NOT NULL DEFAULT 0,      -- 배송완료
  distributed_ids TEXT NOT NULL DEFAULT '[]',     -- 교재 배부 완료 학생(JSON)
  placed          INTEGER NOT NULL DEFAULT 0,      -- 비품 비치완료
  created_at      INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_class_order_purchased ON class_order(purchased);
