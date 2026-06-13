// 원장 대시보드 · 데스크 오늘 API 클라이언트. 백엔드 없으면 throw → 상위에서 폴백.

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()) as T;
}

export interface AdminOverview {
  month: string;
  lastMonth: string;
  summary: { total: number; math: number; eng: number; elem: number; mid: number };
  newThis: number;
  newLast: number;
  late: number;
  absent: number;
  perStudent: { id: string; name: string; late: number; absent: number }[];
  notes: { studentId: string; studentName: string; author: string; body: string; createdAt: number }[];
  students: { id: string; name: string; grade: string; status: string; subjects: string[]; englishBand: string }[];
}

export interface StudentReport {
  id: string;
  month: string;
  student: { name: string; grade: string; school: string; status: string; subjects: string[]; englishBand: string } | null;
  math: {
    present: number;
    late: number;
    absent: number;
    homework: number;
    tests: { date: string; type: string; score: number; status: string }[];
    progress: { date: string; unit: string; area: string; pct: number }[];
  };
  english: {
    attended: number;
    hwChecked: number;
    comments: { date: string; comment: string }[];
    tests: { date: string; name: string; score: number; total: number }[];
    progress: { book: string; level: string; status: string }[];
  };
  notes: { author: string; body: string; createdAt: number }[];
}

export interface TodayRecord {
  name: string;
  grade: string;
  subject: "math" | "english";
  status: string; // 출석/지각/결석/등원
  late: number;
  time: string;
}

export const adminApi = {
  overview: (month?: string) => jget<AdminOverview>("/api/admin/overview" + (month ? "?month=" + month : "")),
  student: (id: string, month?: string) =>
    jget<StudentReport>("/api/admin/student?id=" + encodeURIComponent(id) + (month ? "&month=" + month : "")),
};

export const todayApi = {
  list: () => jget<{ date: string; records: TodayRecord[] }>("/api/today"),
};
