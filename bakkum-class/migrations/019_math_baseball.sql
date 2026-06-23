-- 수학 야구(수학 전광판) — 스트라이크·볼·아웃.
-- 출결·숙제 기록(class_attendance, class_homework)은 손대지 않고 "읽어서" 자동 스트라이크를 만든다.
-- 이 마이그레이션은 (1) 선생님 수동 조정/볼 이벤트, (2) 벌·상 규칙 카탈로그만 새로 저장한다.

-- 수동 이벤트 — 볼 주기, 수동 스트라이크, 스트라이크 취소, 아웃 면제, 보충 완료, 자동 스트라이크 무효화.
CREATE TABLE IF NOT EXISTS class_math_baseball (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,            -- ball|strike|cancel_strike|exempt_out|makeup_done|ignore_auto
  points      INTEGER NOT NULL DEFAULT 1,
  label       TEXT NOT NULL DEFAULT '', -- 사유(규칙 라벨 또는 메모 제목)
  ref         TEXT NOT NULL DEFAULT '', -- ignore_auto일 때 무효화할 자동 스트라이크 id
  memo        TEXT NOT NULL DEFAULT '',
  ts          INTEGER NOT NULL,         -- 효력 시각(ms) — 타임라인 정렬
  by_name     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_class_math_baseball_student ON class_math_baseball(student_id);

-- 벌·상 규칙 카탈로그 — 선생님이 화면에서 추가·수정·삭제. 비어 있으면 코드 기본값(DEFAULT_RULES) 사용.
CREATE TABLE IF NOT EXISTS class_math_baseball_rules (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,            -- strike(벌) | ball(상)
  label       TEXT NOT NULL DEFAULT '',
  points      INTEGER NOT NULL DEFAULT 1,
  trigger_key TEXT NOT NULL DEFAULT 'manual', -- att:지각 / att:무단결석 / att:attitude_미흡 / hw:late / hw:low / manual
  threshold   INTEGER NOT NULL DEFAULT 50,
  enabled     INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0
);
