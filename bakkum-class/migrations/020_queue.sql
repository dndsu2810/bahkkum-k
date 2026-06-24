-- 번호표(대기순번) + 호출 — 영어/수학 과목별. 매일 자정(KST) 기준 1번부터(date 스코프).
CREATE TABLE IF NOT EXISTS class_queue (
  id           TEXT PRIMARY KEY,
  subject      TEXT NOT NULL,            -- 'english' | 'math'
  student_id   TEXT NOT NULL,
  student_name TEXT NOT NULL DEFAULT '',
  number       INTEGER NOT NULL DEFAULT 0,
  date         TEXT NOT NULL,            -- YYYY-MM-DD (KST)
  status       TEXT NOT NULL DEFAULT 'waiting', -- waiting | called | done
  raised       INTEGER NOT NULL DEFAULT 0,      -- 학생 손들기
  created_at   INTEGER NOT NULL DEFAULT 0,
  called_at    INTEGER NOT NULL DEFAULT 0,
  done_at      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_class_queue_sd ON class_queue(subject, date, status);
CREATE INDEX IF NOT EXISTS idx_class_queue_stu ON class_queue(student_id, date);
