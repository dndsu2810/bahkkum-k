// 통합 허브 역할 + 화면(영역) 권한 정의.
//
// 큰 구분: 학생 화면 vs 운영(스태프) 영역.
//  - student            → 본인 기록 조회용 학생 화면.
//  - admin/math/eng/desk → 운영 영역. 원장(admin)이 "각 계정이 어떤 화면을
//                          볼지"를 계정별로 정한다(allowedAreas, scope에 저장).
// 역할은 데이터 범위·기본 화면셋의 '기본값'이고, 원장이 계정별로 덮어쓸 수 있다.

export type Role = "admin" | "developer" | "math" | "english_mid" | "english_elem" | "desk" | "student";

export interface AuthUser {
  sub: string;
  /** 실효 권한 역할. 개발자 계정은 admin과 동일 권한이라 'admin'으로 온다. */
  role: Role;
  name: string;
  /** 원장이 이 계정에 허용한 화면(영역) 키 목록. admin은 전체로 간주. */
  scope?: string[];
  /** 표시용 역할(실효 role과 다를 때). 개발자 = 'developer'. */
  displayRole?: Role;
  /** 담당 과목(개발자/원장 등). 예: ["math"], ["math","eng_elem"]. */
  duty?: string[];
}

/** 화면 표시용 역할(개발자 등 별칭 반영). */
export function shownRole(user: { role: Role; displayRole?: Role }): Role {
  return user.displayRole || user.role;
}

/** 담당 과목 선택지(개발자·원장 등 역할이 과목을 안 정하는 계정용). */
export const SUBJECTS: { key: string; label: string }[] = [
  { key: "math", label: "수학" },
  { key: "eng_mid", label: "영어(중고등)" },
  { key: "eng_elem", label: "영어(초등)" },
];
const SUBJECT_LABEL: Record<string, string> = SUBJECTS.reduce((m, s) => ((m[s.key] = s.label), m), {} as Record<string, string>);
/** 담당 과목 라벨 문자열. 예: ["math","eng_elem"] → "수학 · 영어(초등)". */
export function dutyText(duty?: string[]): string {
  return (duty || []).map((k) => SUBJECT_LABEL[k] || k).join(" · ");
}

/** 역할 한글 라벨. */
export const ROLE_LABEL: Record<Role, string> = {
  admin: "원장",
  developer: "개발자",
  math: "수학 강사",
  english_mid: "영어 강사",
  english_elem: "초등영어 강사",
  desk: "데스크",
  student: "학생",
};

/** 원장이 강사 계정을 만들 때 고를 수 있는 역할(학생 제외). */
export const ASSIGNABLE_ROLES: Role[] = ["admin", "developer", "math", "english_mid", "english_elem", "desk"];

/** 역할 한 줄 설명(계정 등록 화면용). */
export const ROLE_DESC: Record<Role, string> = {
  admin: "전체 열람 + 강사 등록·배분·화면 설정",
  developer: "원장과 동일 권한 (개발·운영용)",
  math: "수학 전체(초등+중고등) 수업 기록",
  english_mid: "중고등 영어 일일기록·테스트",
  english_elem: "초등 영어 일일기록",
  desk: "전체 시간표·계정·학생 조회",
  student: "본인 기록 조회",
};

/* ---------------- 화면(영역) 카탈로그 ----------------
   원장이 계정별로 켜고 끄는 단위. 실제 화면은 단계별로 채워진다. */
export type AreaKey =
  | "students" // 공통 학생 마스터
  | "math" // 수학 관리(현재 앱)
  | "eng_mid" // 영어(중고등)
  | "eng_elem" // 영어(초등)
  | "desk" // 데스크(시간표·계정·학생 조회)
  | "notes" // 강사 특이사항(공용)
  | "board" // 강사 업무 보드(공용)
  | "wiki" // 바꿈 매뉴얼
  | "sns" // SNS 관리
  | "report"; // 월말리포트

export interface AreaDef {
  key: AreaKey;
  label: string;
  desc: string;
  /** 아직 구현 전이면 true(허브에서 '준비 중'으로 표시). */
  pending?: boolean;
}

export const AREAS: AreaDef[] = [
  { key: "students", label: "학생 마스터", desc: "공통 학생 명단 · 수강과목 · 영어반 배정" },
  { key: "math", label: "수학 관리", desc: "수학 출결·숙제·진도·테스트·월말리포트(현재 앱)" },
  { key: "eng_mid", label: "영어 (중고등)", desc: "중고등 영어 일일기록·테스트" },
  { key: "eng_elem", label: "영어 (초등)", desc: "초등 영어 일일기록·리포트" },
  { key: "desk", label: "데스크", desc: "전체 시간표·계정 리스트·학생 조회" },
  { key: "notes", label: "강사 특이사항", desc: "학생별 특이사항(공용 누적)" },
  { key: "board", label: "강사 업무 보드", desc: "칸반 업무(공유·실시간)" },
  { key: "wiki", label: "바꿈 매뉴얼", desc: "운영 매뉴얼 위키(학생 제외)" },
  { key: "sns", label: "SNS 관리", desc: "SNS 글 등록·업로드" },
  { key: "report", label: "월말리포트", desc: "영어 성적표 이미지 일괄 저장" },
];

export const AREA_LABEL: Record<AreaKey, string> = AREAS.reduce(
  (m, a) => ((m[a.key] = a.label), m),
  {} as Record<AreaKey, string>
);

/** 역할별 기본 허용 화면 — 원장이 계정 등록 시 자동 선택(이후 수정 가능). */
export const DEFAULT_AREAS: Record<Role, AreaKey[]> = {
  admin: AREAS.map((a) => a.key), // 전체
  developer: AREAS.map((a) => a.key), // 원장과 동일(전체)
  math: ["math", "students", "notes", "board", "wiki"],
  english_mid: ["eng_mid", "students", "notes", "board", "wiki"],
  english_elem: ["eng_elem", "students", "notes", "board", "wiki"],
  desk: ["desk", "students", "notes", "board", "wiki", "sns"],
  student: [],
};

/** 이 사용자가 실제로 볼 수 있는 화면 키 목록. admin은 전체. */
export function areasForUser(user: { role: Role; scope?: string[] }): AreaKey[] {
  if (user.role === "admin" || user.role === "developer") return AREAS.map((a) => a.key);
  const allow = new Set(user.scope || DEFAULT_AREAS[user.role] || []);
  return AREAS.map((a) => a.key).filter((k) => allow.has(k));
}

/** 이 역할/계정이 기존 수학 관리 앱(현재 bakkum-class)에 접근하는가. */
export function usesMathApp(user: { role: Role; scope?: string[] }): boolean {
  if (user.role === "student") return false;
  return areasForUser(user).includes("math");
}

/** 매뉴얼 위키 열람 가능(학생 제외 전원). */
export function canViewWiki(role: Role): boolean {
  return role !== "student";
}
