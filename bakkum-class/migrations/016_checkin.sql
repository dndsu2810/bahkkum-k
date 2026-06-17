-- Migration 016 — 등하원(체크인) 기능.
-- 1) 학생별 등하원 기록 테이블, 2) 학원이 부여하는 출석번호(checkin_no) 컬럼.
-- (워커가 부팅 시 자동 생성/추가도 하지만, 기록용으로 남긴다.) Additive. Run once:
--   wrangler d1 execute bakuum-production --remote --file=./migrations/016_checkin.sql

CREATE TABLE IF NOT EXISTS class_checkin (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  date        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT '등원',   -- 등원 | 하원
  subject     TEXT NOT NULL DEFAULT '',        -- 영어 | 수학 | ''
  time        TEXT NOT NULL DEFAULT '',        -- HH:MM (KST)
  sent        INTEGER NOT NULL DEFAULT 0,       -- 학부모 알림 발송 여부
  sent_at     INTEGER NOT NULL DEFAULT 0,
  corrected   INTEGER NOT NULL DEFAULT 0,       -- 발송 후 재기록 → 정정 필요
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_class_checkin_date ON class_checkin(date);
CREATE INDEX IF NOT EXISTS idx_class_checkin_student ON class_checkin(student_id);

-- 출석번호 — 학원이 직접 부여(학생이 키오스크 키패드로 입력).
ALTER TABLE class_student_meta ADD COLUMN checkin_no TEXT NOT NULL DEFAULT '';
