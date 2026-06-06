-- Migration 005 — app-only "삭제(숨김)" flag for students.
-- Lets the app remove a student from its own views WITHOUT touching the shared
-- Notion/mogakgong roster. Additive. Run once:
--   wrangler d1 execute bakuum-production --remote --file=./migrations/005_student_hidden.sql

ALTER TABLE students ADD COLUMN hidden INTEGER DEFAULT 0;
