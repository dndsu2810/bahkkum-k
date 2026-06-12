/** 수업 구분 이름 (설정에서 정의; 기본 초등/중등). */
export type Grade = string;
export type MakeupStatus = "pending" | "scheduled" | "skip" | "done";
/** Derived display status (adds "done" once a scheduled makeup date has passed). */
export type MakeupDisplay = "pending" | "scheduled" | "done" | "skip";

/** 재원/휴원/퇴원/대기 — only 재원 students appear in the dashboard/attendance/timetable. */
export type StudentStatus = "재원" | "휴원" | "퇴원" | "대기";

export type AttStatus = "출석" | "지각" | "결석" | "조퇴" | "무단결석" | "보강";
export type Attitude = "매우좋음" | "보통" | "미흡";

export interface Lesson {
  day: string; // '월'..'일'
  time: string; // HH:MM
  duration: number; // minutes
}

/** 한 시점부터 적용되는 시간표. 시간표가 바뀌면 새 버전이 쌓이고,
 *  출결 체크는 해당 날짜에 유효한 버전을 사용한다. */
export interface ScheduleVersion {
  from: string; // YYYY-MM-DD — 이 날짜부터 적용
  lessons: Lesson[];
}

export interface Student {
  id: string;
  name: string;
  grade: Grade;
  startDate: string; // YYYY-MM-DD
  excluded: boolean;
  status: StudentStatus;
  school: string;
  birthdate: string; // YYYY-MM-DD or ''
  parentPhone: string;
  studentPhone: string;
  /** 현재(최신) 적용 시간표. schedule이 있으면 마지막 버전의 lessons와 동일. */
  lessons: Lesson[];
  /** 시간표 변경 이력(적용 시작일 오름차순). 없으면 lessons를 단일 시간표로 사용. */
  schedule?: ScheduleVersion[];
  /** 앱에서 직접 수정해 '앱 소유'가 된 필드(name·school·grade·status). 노션 동기화가
   *  이 필드는 덮어쓰지 않는다. (명단=노션 원본, 단 앱 수정분은 보존) */
  appEdited?: string[];
}

export interface Makeup {
  id: string;
  studentId: string;
  absentDate: string;
  absentTime: string;
  absentDuration: number;
  attKey: string;
  status: MakeupStatus;
  makeupDate: string;
  makeupTime: string;
  makeupDuration: number;
  parentContacted: boolean;
  memo: string;
  createdAt: number;
}

/** One attendance mark. key = "YYYY-MM-DD|studentId|HH:MM" */
export interface AttRecord {
  status: AttStatus;
  lateMinutes?: number; // only for 지각
  attitude?: Attitude | "";
  note?: string;
  /** true once a +20 출석 point has been awarded for this mark (idempotency). */
  pointsAwarded?: boolean;
}

export type Attendance = Record<string, AttRecord>;

/** A homework record (숙제 관리 페이지에서 기록 → 월말리포트에 누적). */
export interface HwLog {
  id: string;
  studentId: string;
  date: string; // YYYY-MM-DD (숙제 마감일 — 노션 매칭 기준, 바뀌지 않음)
  book: string;
  tags: string[];
  completion: number; // 0..100
  status: "pending" | "done" | "late"; // 검사 전 / 검사완료 / 지연
  memo: string;
  /** 지연(밀림) 횟수 — 노션 '숙제 현황'에 'N차 밀림'으로 반영. */
  delayCount?: number;
  /** 다시 검사할 날짜(YYYY-MM-DD). 지연 시 지정 → 오늘 페이지에서 이 날짜에 다시 뜸. */
  recheckDate?: string;
}

/** A progress record (진도 관리). 날짜가 아니라 진행중/완료(완성도 100)가 기준. */
export interface ProgLog {
  id: string;
  studentId: string;
  unit: string;
  area: string;
  pct: number; // 달성률 0..100 (100 = 완료)
  startDate: string; // 학습 시작일
  memo: string;
}

/** A test/평가 record (테스트 관리 → 노션 수학 테스트 DB와 동일 양식 → 월말리포트 평가에 누적). */
export interface TestLog {
  id: string;
  studentId: string;
  date: string; // 시험일 YYYY-MM-DD
  type: string; // 시험 유형 (예: 주간평가, 경시대회)
  round: string; // 회차 (예: 6월 2주차)
  range: string; // 시험 범위
  score: number; // 점수 (status가 '예정'이면 미입력으로 간주)
  status: "예정" | "완료"; // 평가 상태
  memo: string; // 특이사항
}

/** 강사 업무 보드(칸반) 카드 1장. */
export type TaskStatus = "todo" | "doing" | "done";
export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  /** 분류 태그 (보강·학부모·교재·경시·마케팅·행정·수업준비 등). 빈 값 가능. */
  tag?: string;
  /** 마감일 YYYY-MM-DD (선택). */
  due?: string;
  /** 연결 학생 id (선택). */
  studentId?: string;
  memo?: string;
  /** 자동 생성 카드 식별/중복방지 키 (예: "absence:<attKey>"). 수동 카드는 빈 값. */
  source?: string;
  createdAt: number;
  /** 완료 처리 시각 — 완료 후 7일 지나면 보관함 자동 이동 기준. */
  doneAt?: number;
  /** 보관함으로 이동됨 (보드에서 숨김). */
  archived?: boolean;
}

export interface DataSnapshot {
  students: Student[];
  makeups: Makeup[];
  attendance: Attendance;
  homeworkLog: HwLog[];
  progressLog: ProgLog[];
  testLog: TestLog[];
  /** 강사 업무 보드 카드. */
  tasks?: Task[];
  /** 사용자가 직접 삭제한 보강(결석)의 attKey 목록 — 노션 재가져오기/재체크 때
   *  자동으로 보강 대기가 되살아나지 않도록 하는 '삭제 표시(tombstone)'. */
  dismissedMakeups?: string[];
  /** '오늘 숙제 없음'으로 정리한 표식 목록 (key = "studentId|YYYY-MM-DD"). 숙제 기록을
   *  만들지 않고 '내줄 숙제 정리 완료'만 기억한다. */
  noHomework?: string[];
}
