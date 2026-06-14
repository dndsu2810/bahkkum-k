/// <reference types="@cloudflare/workers-types" />
// 통합 허브 인증 — 강사/학생 로그인, 서명 쿠키 세션, PIN 해시.
//
// 설계 메모:
//  - 강사 계정: class_users 테이블(이름 + 숫자 PIN). 원장이 등록.
//  - 학생 로그인: 기존 students 테이블(이름 + 생년월일). 별도 행 없음.
//  - 세션: 상태 없는 서명 쿠키(HMAC-SHA256). sessions 테이블 불필요.
//  - 비밀번호는 PBKDF2(SHA-256, 솔트)로 해시. PIN이 짧아도 반복 횟수로 보강.

import type { Env } from "./index";

export type Role = "admin" | "developer" | "math" | "english_mid" | "english_elem" | "desk" | "student";

export interface SessionUser {
  /** 강사: "u_xxx" / 학생: 로스터 student id(숫자 문자열) */
  sub: string;
  /** 실효 권한 역할. 개발자 계정은 admin과 동일 권한이라 여기선 'admin'으로 둔다. */
  role: Role;
  name: string;
  /** 담당(과목/학년) 배분 — 강사만. 예: ["math"], ["english_mid"] */
  scope?: string[];
  /** 표시용 역할(실효 role과 다를 때). 개발자 계정 = 'developer'. */
  displayRole?: Role;
}

export interface UserRow {
  id: string;
  name: string;
  role: Role;
  scope: string[];
  createdAt: number;
}

const COOKIE = "bk_session";
const SESSION_DAYS = 30;
const PBKDF2_ITER = 100_000;

/* ---------------- 테이블 보장 + 원장 부트스트랩 ---------------- */
export async function ensureUsersTable(env: Env): Promise<void> {
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS class_users (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'math', scope TEXT NOT NULL DEFAULT '[]', pin_hash TEXT NOT NULL DEFAULT '', salt TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0)"
    ).run();
  } catch {
    /* ignore */
  }
  // 계정별 화면 설정(메뉴 순서·즐겨찾기 등)을 PC가 달라도 따라오게 계정에 저장.
  // 컬럼 추가는 IF NOT EXISTS가 없어 try/catch(이미 있으면 무시).
  try {
    await env.DB.prepare("ALTER TABLE class_users ADD COLUMN prefs TEXT NOT NULL DEFAULT ''").run();
  } catch {
    /* 이미 있으면 무시 */
  }
  // 평문 비번 보관(pin_plain)은 제거됨 — 아래 마이그레이션에서 컬럼 드롭. 비번은 pin_hash로만.
  try {
    await env.DB.prepare("ALTER TABLE class_users DROP COLUMN pin_plain").run();
  } catch {
    /* 없으면 무시 */
  }
  // 원장(이지현) 부트스트랩 — admin이 한 명도 없으면 기본 PIN으로 생성.
  // 기본 PIN은 env.ADMIN_PIN 또는 폴백. 첫 로그인 후 설정에서 변경 권장.
  try {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM class_users WHERE role='admin'").first<{ n: number }>();
    if (!row || Number(row.n) === 0) {
      const pin = (env.ADMIN_PIN || "112233").trim();
      const { hash, salt } = await hashPin(pin);
      await env.DB
        .prepare("INSERT INTO class_users(id,name,role,scope,pin_hash,salt,created_at) VALUES(?,?,?,?,?,?,?)")
        .bind("u_admin", "이지현", "admin", JSON.stringify(["math"]), hash, salt, Date.now())
        .run();
    }
  } catch {
    /* ignore */
  }
}

/* ---------------- PIN 해시 (PBKDF2) ---------------- */
const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(pin: string, saltHex: string): Promise<string> {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" },
    key,
    256
  );
  return toHex(bits);
}

export async function hashPin(pin: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = toHex(saltBytes.buffer);
  const hash = await pbkdf2(pin, salt);
  return { hash, salt };
}

export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  if (!hash || !salt) return false;
  const calc = await pbkdf2(pin, salt);
  // 길이 같으면 상수시간 비교
  if (calc.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

/* ---------------- 서명 쿠키 세션 ---------------- */
function b64urlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad)));
}

function secret(env: Env): string {
  return env.AUTH_SECRET || env.BOT_SECRET || "bakkum-hub-default-secret-change-me";
}

async function hmac(env: Env, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return toHex(sig);
}

export async function signSession(env: Env, user: SessionUser): Promise<string> {
  const payload = { ...user, exp: Date.now() + SESSION_DAYS * 86400000 };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmac(env, body);
  return `${body}.${sig}`;
}

export async function readSession(env: Env, request: Request): Promise<SessionUser | null> {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (!m) return null;
  const token = m[1];
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = await hmac(env, body);
  if (sig !== expect) return null;
  try {
    const p = JSON.parse(b64urlDecode(body)) as SessionUser & { exp: number };
    if (!p.exp || p.exp < Date.now()) return null;
    return { sub: p.sub, role: p.role, name: p.name, scope: p.scope, displayRole: p.displayRole };
  } catch {
    return null;
  }
}

export function sessionCookie(token: string): string {
  const maxAge = SESSION_DAYS * 86400;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}
export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

/* ---------------- 강사 계정 CRUD 헬퍼 ---------------- */
export async function listUsers(env: Env): Promise<UserRow[]> {
  await ensureUsersTable(env);
  const r = await env.DB.prepare("SELECT id,name,role,scope,created_at FROM class_users ORDER BY created_at").all<{
    id: string;
    name: string;
    role: string;
    scope: string;
    created_at: number;
  }>();
  return (r.results || []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    role: row.role as Role,
    scope: parseScope(row.scope),
    createdAt: Number(row.created_at),
  }));
}

function parseScope(s: unknown): string[] {
  try {
    const v = JSON.parse(String(s ?? "[]"));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

let uidCounter = 0;
function newUserId(): string {
  return "u_" + Date.now().toString(36) + (uidCounter++).toString(36);
}

export async function createUser(
  env: Env,
  input: { name: string; role: Role; scope: string[]; pin: string }
): Promise<UserRow> {
  await ensureUsersTable(env);
  const { hash, salt } = await hashPin(input.pin);
  const id = newUserId();
  const createdAt = Date.now();
  await env.DB.prepare(
    "INSERT INTO class_users(id,name,role,scope,pin_hash,salt,created_at) VALUES(?,?,?,?,?,?,?)"
  )
    .bind(id, input.name, input.role, JSON.stringify(input.scope), hash, salt, createdAt)
    .run();
  return { id, name: input.name, role: input.role, scope: input.scope, createdAt };
}

export async function updateUser(
  env: Env,
  id: string,
  patch: { name?: string; role?: Role; scope?: string[]; pin?: string }
): Promise<void> {
  await ensureUsersTable(env);
  if (patch.name != null)
    await env.DB.prepare("UPDATE class_users SET name=? WHERE id=?").bind(patch.name, id).run();
  if (patch.role != null)
    await env.DB.prepare("UPDATE class_users SET role=? WHERE id=?").bind(patch.role, id).run();
  if (patch.scope != null)
    await env.DB.prepare("UPDATE class_users SET scope=? WHERE id=?").bind(JSON.stringify(patch.scope), id).run();
  if (patch.pin) {
    const { hash, salt } = await hashPin(patch.pin);
    await env.DB.prepare("UPDATE class_users SET pin_hash=?, salt=? WHERE id=?").bind(hash, salt, id).run();
  }
}

export async function deleteUser(env: Env, id: string): Promise<void> {
  await ensureUsersTable(env);
  // 원장(admin) 계정이 0이 되지 않도록 보호: 마지막 admin은 삭제 거부.
  if (id) {
    const row = await env.DB.prepare("SELECT role FROM class_users WHERE id=?").bind(id).first<{ role: string }>();
    if (row?.role === "admin") {
      const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM class_users WHERE role='admin'").first<{ n: number }>();
      if (c && Number(c.n) <= 1) throw new Error("last_admin");
    }
  }
  await env.DB.prepare("DELETE FROM class_users WHERE id=?").bind(id).run();
}

/* ---------------- 계정별 화면 설정(메뉴 순서·즐겨찾기) ---------------- */
export async function getUserPrefs(env: Env, sub: string): Promise<string> {
  await ensureUsersTable(env);
  try {
    const r = await env.DB.prepare("SELECT prefs FROM class_users WHERE id=?").bind(sub).first<{ prefs: string }>();
    return r?.prefs || "";
  } catch {
    return "";
  }
}
export async function setUserPrefs(env: Env, sub: string, prefs: string): Promise<void> {
  await ensureUsersTable(env);
  try {
    await env.DB.prepare("UPDATE class_users SET prefs=? WHERE id=?").bind(prefs.slice(0, 8000), sub).run();
  } catch {
    /* 학생 등 class_users에 없는 계정이면 무시 */
  }
}

/* ---------------- 로그인 ---------------- */
/** 강사 로그인: 이름 + PIN. 동명이인은 PIN이 맞는 첫 계정. */
export async function loginTeacher(env: Env, name: string, pin: string): Promise<SessionUser | null> {
  await ensureUsersTable(env);
  const r = await env.DB.prepare("SELECT id,name,role,scope,pin_hash,salt FROM class_users WHERE name=?")
    .bind(name.trim())
    .all<{ id: string; name: string; role: string; scope: string; pin_hash: string; salt: string }>();
  for (const row of r.results || []) {
    if (await verifyPin(pin.trim(), String(row.pin_hash), String(row.salt))) {
      const real = String(row.role) as Role;
      // 개발자 계정은 원장(admin)과 동일 권한 — 실효 role은 admin, 표시만 developer.
      if (real === "developer") {
        return { sub: String(row.id), role: "admin", name: String(row.name), scope: parseScope(row.scope), displayRole: "developer" };
      }
      return { sub: String(row.id), role: real, name: String(row.name), scope: parseScope(row.scope) };
    }
  }
  return null;
}

/** 학생 로그인: 이름 + 생년월일 6자리(YYMMDD). 8자리(YYYYMMDD)도 호환. 기존 students 테이블 조회. */
export async function loginStudent(env: Env, name: string, birth: string): Promise<SessionUser | null> {
  const norm = (s: string) => s.replace(/[^0-9]/g, ""); // 숫자만
  const want = norm(birth);
  if (want.length !== 6 && want.length !== 8) return null;
  const r = await env.DB.prepare(
    "SELECT id,name,birth_date FROM students WHERE name=? AND (hidden IS NULL OR hidden=0)"
  )
    .bind(name.trim())
    .all<{ id: number; name: string; birth_date: string | null }>();
  for (const row of r.results || []) {
    const got = norm(String(row.birth_date ?? "")); // 보통 8자리(YYYYMMDD)
    if (!got) continue;
    // 6자리는 끝 6자리(YYMMDD)로 비교, 8자리는 전체 비교.
    const match = want.length === 6 ? got.slice(-6) === want : got === want;
    if (match) {
      return { sub: String(row.id), role: "student", name: String(row.name) };
    }
  }
  return null;
}
