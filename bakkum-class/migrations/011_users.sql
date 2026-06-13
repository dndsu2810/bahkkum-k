-- 통합 허브 강사/관리자 계정 (학생은 기존 students 테이블로 로그인).
-- 워커가 ensureUsersTable로 자가 생성하지만, 명시적 마이그레이션도 보관.
CREATE TABLE IF NOT EXISTS class_users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'math',   -- admin|math|english_mid|english_elem|desk
  scope      TEXT NOT NULL DEFAULT '[]',      -- 담당 배분(JSON 배열)
  pin_hash   TEXT NOT NULL DEFAULT '',        -- PBKDF2-SHA256
  salt       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);
