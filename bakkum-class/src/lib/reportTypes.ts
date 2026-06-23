// Monthly report data model.
// Attendance is computed from class_attendance (real data); everything else
// (evaluations, homework, progress, comment, notes) is entered in the report
// form and persisted to localStorage per student+month.

export interface EvalItem {
  id: string;
  type: "주간평가" | "경시대회";
  name: string;
  meta: string; // 단원 등
  date: string; // YYYY-MM-DD or free text
  score: number;
}

export interface HwItem {
  id: string;
  date: string; // YYYY-MM-DD
  book: string;
  tags: string[];
  completion: number; // 0..100
  status: "pending" | "done" | "late"; // 검사 전 / 검사완료 / 지연
  memo: string;
  /** 지연(밀림) 횟수 — >0이면서 done이면 '지연검사완료'로 표시. */
  delayCount?: number;
  /** 실제 검사완료한 날짜(YYYY-MM-DD) — 지연 검사 시 '언제 검사했는지' 특이사항에 작게. */
  checkedDate?: string;
}

export interface NoteItem {
  id: string;
  dateLabel: string; // "05 / 04" or "05 / 12 – 21"
  tone: "r" | "b" | "g";
  text: string;
}

export interface ProgressBook {
  unit: string; // 교재명
  area: string; // 범위·단계
  startDate: string; // 시작일
  endDate?: string; // 완료일(완료한 경우)
}

export interface ProgressInfo {
  pct: number; // 달성률 0..100
  unit: string; // 현재 학습 단원
  area: string; // 학습 영역
  startDate: string; // 학습 시작일
  weeks: string; // 학습 기간 (예: 약 6주차)
  booksInProgress?: ProgressBook[]; // 이 달에 진행중인 교재
  booksCompleted?: ProgressBook[]; // 이 달에 완료한 교재
}

/** 1:1 보충학습 한 줄 — 오늘/대시보드/리포트에서 입력한 보충수업(SupLog)과 같은 항목. */
export interface SupItem {
  id: string;
  date: string; // 보충 일시 YYYY-MM-DD
  minutes: number; // 보충 시간(분)
  reason: string; // 보충 사유
  name?: string; // 보충명
  content?: string; // 학습내용
  note?: string; // 비고
}

export interface ReportExtras {
  comment: string;
  progress: ProgressInfo;
  evals: EvalItem[];
  homeworks: HwItem[];
  notes: NoteItem[];
  /** 1:1 보충학습 — 오늘/대시보드/리포트에서 입력한 보충수업(SupLog) 자동 반영. */
  supplements?: SupItem[];
}

/** day-of-month → attendance bucket for the calendar */
export type DayBucket = "p" | "l" | "m" | "a"; // 출석 / 지각 / 보강 / 결석류

export interface AttSummary {
  total: number;
  present: number; // 출석+지각+조퇴 (calendar/legend 출석)
  makeup: number; // 보강
  absent: number; // 결석+무단결석
  late: number; // 지각 횟수
  lateMin: number; // 지각 누적 분
  rate: number; // (출석+지각)/total*100
  /** 하루에 정규 출석 + 보강이 함께 있을 수 있으므로 버킷 배열 (출석 p → 보강 m → 결석 a 순). */
  days: Record<number, DayBucket[]>;
}

export interface ReportData {
  studentId: string;
  studentName: string;
  year: number;
  month: number;
  teacher: string;
  att: AttSummary;
  extras: ReportExtras;
}

export function emptyExtras(): ReportExtras {
  return {
    comment: "",
    progress: { pct: 0, unit: "", area: "", startDate: "", weeks: "" },
    evals: [],
    homeworks: [],
    notes: [],
  };
}
