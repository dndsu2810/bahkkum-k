// 학생 정보 localStorage 헬퍼.
// 1단계는 이름(닉네임)만으로 식별 (지현 선택, 2026-05-22).
// 학생코드/D1 연동은 나중 단계에서 확장.

export type Student = {
  name: string;
  joined_at: string;
  last_played: string | null;
  total_plays: number;
};

const STUDENT_KEY = "ezssam_student";

export function getStudent(): Student | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STUDENT_KEY);
    return raw ? (JSON.parse(raw) as Student) : null;
  } catch {
    return null;
  }
}

/** 이름으로 학생 정보를 만들거나(첫 방문) 이름만 갱신(재방문). */
export function saveStudent(name: string): Student {
  const trimmed = name.trim();
  const existing = getStudent();
  const now = new Date().toISOString();
  const student: Student = existing
    ? { ...existing, name: trimmed }
    : { name: trimmed, joined_at: now, last_played: null, total_plays: 0 };
  window.localStorage.setItem(STUDENT_KEY, JSON.stringify(student));
  return student;
}

export function clearStudent(): void {
  window.localStorage.removeItem(STUDENT_KEY);
}

/** 게임을 한 판 했을 때 학생의 누적 플레이 수/마지막 플레이 시각 갱신. */
export function recordStudentPlay(): void {
  const s = getStudent();
  if (!s) return;
  const updated: Student = {
    ...s,
    last_played: new Date().toISOString(),
    total_plays: s.total_plays + 1,
  };
  window.localStorage.setItem(STUDENT_KEY, JSON.stringify(updated));
}
