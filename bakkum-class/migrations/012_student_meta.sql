-- 공통 학생 마스터 — 허브 전용 학생 필드(온라인ID·수강과목·영어반).
-- 기존 students 로스터(노션·모각공 공유)는 건드리지 않고 별도 보관.
-- 워커가 ensureStudentMeta로 자가 생성하지만, 명시적 마이그레이션도 보관.
CREATE TABLE IF NOT EXISTS class_student_meta (
  student_id   TEXT PRIMARY KEY,
  online_id    TEXT NOT NULL DEFAULT '',
  subjects     TEXT NOT NULL DEFAULT '',   -- JSON 배열: ["math","english"]
  english_band TEXT NOT NULL DEFAULT '',    -- 'elem' | 'mid' | ''
  updated_at   INTEGER NOT NULL DEFAULT 0
);
