// 중고등 영어 시간표 시드(구글시트 1Sn-yqCX… 파싱). 원장이 '시간표 가져오기'로 1회 반영.
// 이름으로 학생 매칭 → class_eng_lessons 교체(영어만, 수학 불변). 시간은 24시·수업시간(분).
// 시트가 바뀌면 이 표만 갱신하면 됨.

interface SeedRow {
  name: string;
  days: string[];
  time: string; // HH:MM (24h)
  duration: number; // 분
}

const SEED: SeedRow[] = [
  { name: "김민후", days: ["화", "수", "목"], time: "16:40", duration: 100 },
  { name: "정리연", days: ["화", "목"], time: "17:00", duration: 150 },
  { name: "조유나", days: ["화", "목"], time: "17:00", duration: 150 },
  { name: "도하람", days: ["화", "수", "목"], time: "17:00", duration: 150 },
  { name: "김소정", days: ["화", "목"], time: "17:00", duration: 150 },
  { name: "배석율", days: ["화", "목"], time: "17:00", duration: 150 },
  { name: "이지은", days: ["화", "목"], time: "17:00", duration: 150 },
  { name: "오민아", days: ["화", "목"], time: "17:30", duration: 180 },
  { name: "김동현", days: ["화", "목"], time: "17:30", duration: 180 },
  { name: "조윤후", days: ["화", "목"], time: "17:30", duration: 180 },
  { name: "장진혁", days: ["수", "금"], time: "17:00", duration: 150 },
  { name: "조윤아", days: ["월", "수", "금"], time: "17:00", duration: 150 },
  { name: "최정우", days: ["월", "수", "금"], time: "17:30", duration: 100 },
  { name: "박성현", days: ["수", "금"], time: "17:30", duration: 180 },
  { name: "신승민", days: ["월", "목", "금"], time: "17:30", duration: 180 },
  { name: "최수민", days: ["월", "수"], time: "17:00", duration: 150 },
  { name: "하재연", days: ["월", "수"], time: "17:00", duration: 150 },
  { name: "유시현", days: ["월", "수"], time: "17:00", duration: 150 },
  { name: "장서윤", days: ["월", "수"], time: "17:00", duration: 150 },
  { name: "이유리", days: ["월", "수"], time: "17:00", duration: 150 },
  { name: "김예훈", days: ["월", "수"], time: "17:00", duration: 150 },
  { name: "민준영", days: ["월", "수"], time: "17:00", duration: 150 },
  { name: "윤여준", days: ["월", "수"], time: "17:00", duration: 150 },
  { name: "이시윤", days: ["월", "수"], time: "17:00", duration: 150 },
  { name: "김선우", days: ["월", "수"], time: "17:30", duration: 180 },
  { name: "정수경", days: ["월", "수"], time: "17:30", duration: 180 },
];

/** 이름 → 슬롯(요일·시간·분) 목록. 가져오기 엔드포인트로 전송. */
export const MID_ENG_TIMETABLE: { name: string; slots: { day: string; time: string; duration: number }[] }[] = SEED.map(
  (r) => ({ name: r.name, slots: r.days.map((day) => ({ day, time: r.time, duration: r.duration })) })
);
