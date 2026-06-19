// 인증 API 클라이언트 — 로그인/로그아웃/세션조회 + 강사 계정 CRUD.
// 백엔드(워커)가 없는 dev/static 환경에서는 null/실패를 반환해 상위에서 폴백.

import type { AuthUser, Role } from "./roles";

export interface UserRow {
  id: string;
  name: string;
  role: Role;
  scope: string[];
  duty: string[];
  createdAt: number;
}

/** 현재 세션 사용자. 200→user, 401→null, 그 외(백엔드 없음)→throw "no_backend". */
export async function fetchMe(): Promise<AuthUser | null> {
  let r: Response;
  try {
    r = await fetch("/api/auth/me", { cache: "no-store" });
  } catch {
    throw new Error("no_backend");
  }
  if (r.status === 401) return null;
  if (!r.ok) throw new Error("no_backend");
  const j = (await r.json().catch(() => ({}))) as { user?: AuthUser | null };
  return j.user ?? null;
}

export async function loginTeacher(name: string, pin: string): Promise<AuthUser> {
  return doLogin({ kind: "teacher", name, pin });
}
export async function loginStudent(name: string, birth: string): Promise<AuthUser> {
  return doLogin({ kind: "student", name, birth });
}

async function doLogin(body: Record<string, string>): Promise<AuthUser> {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as { user?: AuthUser; error?: string; status?: string };
  if (!r.ok || !j.user) {
    // 휴원·퇴원 차단은 상태를 함께 전달(안내 팝업용): "student_blocked:휴원".
    if (j.error === "student_blocked" && j.status) throw new Error("student_blocked:" + j.status);
    throw new Error(j.error || "login_failed");
  }
  return j.user;
}

/* ---------------- 계정별 화면 설정(메뉴 순서·즐겨찾기) ---------------- */
/** 서버에 저장된 내 설정 JSON 문자열. 없거나 백엔드 없으면 null. */
export async function getMyPrefs(): Promise<string | null> {
  try {
    const r = await fetch("/api/me/prefs", { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => ({}))) as { prefs?: string };
    return typeof j.prefs === "string" ? j.prefs : null;
  } catch {
    return null;
  }
}
export async function saveMyPrefs(prefs: string): Promise<void> {
  try {
    await fetch("/api/me/prefs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefs }),
    });
  } catch {
    /* ignore (오프라인 등) — 로컬 캐시는 유지됨 */
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
}

/* ---------------- 강사 계정 관리 (원장 전용) ---------------- */
export async function listUsers(): Promise<UserRow[]> {
  const r = await fetch("/api/users", { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = (await r.json()) as { users: UserRow[] };
  return j.users || [];
}

export async function createUser(input: { name: string; role: Role; pin: string; scope?: string[]; duty?: string[] }): Promise<void> {
  const r = await fetch("/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || "create_failed");
  }
}

export async function updateUser(input: {
  id: string;
  name?: string;
  role?: Role;
  pin?: string;
  scope?: string[];
  duty?: string[];
}): Promise<void> {
  const r = await fetch("/api/users/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || "update_failed");
  }
}

export async function deleteUser(id: string): Promise<void> {
  const r = await fetch("/api/users/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || "delete_failed");
  }
}
