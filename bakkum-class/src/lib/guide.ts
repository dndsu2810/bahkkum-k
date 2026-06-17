// 앱 사용 가이드 콘텐츠 — 역할(권한)별로 "무슨 메뉴가 보이고 어떻게 쓰는지" 정리.
//
// 단일 출처(single source): 앱 안 도움말 화면(src/screens/Guide.tsx)과
// 배포용 노션 문서가 모두 이 데이터를 따른다. 메뉴 구성은 sidebarFor()
// (src/lib/workspace.tsx)와 일치하도록 유지한다 — 사이드바에 없는 화면은
// 여기에도 넣지 않는다.

import type { IconName } from "../icons";
import type { Role } from "./roles";

/** 가이드 한 항목(메뉴/기능 하나). */
export interface GuideTopic {
  /** 메뉴 이름(사이드바 라벨과 동일). */
  title: string;
  icon?: IconName;
  /** 한 줄 목적. */
  what: string;
  /** 사용 순서/주요 동작(3~6개). */
  steps?: string[];
  /** 권한·주의 등 한 줄 메모. */
  tip?: string;
}

/** 사이드바 카테고리 단위 묶음. */
export interface GuideGroup {
  label: string;
  topics: GuideTopic[];
}

export interface RoleGuide {
  title: string;
  /** 이 역할이 무엇을 하는 계정인지 한두 문장. */
  summary: string;
  /** 로그인 직후 첫 화면 설명. */
  start: string;
  groups: GuideGroup[];
}

/* ---------------- 공통 항목(여러 역할이 공유) ---------------- */

const HOME: GuideTopic = {
  title: "홈",
  icon: "today",
  what: "로그인하면 처음 열리는 화면. 인사말과 자주 쓰는 메뉴 바로가기, 오늘 처리할 일 요약을 보여줘요.",
  steps: [
    "상단의 '오늘 수업 보기' 버튼으로 바로 오늘 화면으로 이동",
    "요약 카드(받은 변경 요청·보강 대기·재원 학생 등)를 누르면 해당 화면으로 점프",
    "자주 쓰는 화면 타일을 눌러 빠르게 이동",
  ],
};

const SCHEDULE: GuideTopic = {
  title: "학원 일정",
  icon: "calplus",
  what: "모두가 함께 보는 학원 공용 달력. 시험·행사·휴원·할 일 등을 한곳에서 관리해요.",
  steps: [
    "월 이동(이전/다음/오늘)과 달력·목록 보기 전환",
    "빈 날짜를 눌러 일정 추가 — 시작일·종료일·제목·분류·메모 입력",
    "분류(학원/학교/강사/휴원/할일)별로 색이 달라 한눈에 구분",
  ],
  tip: "강사 누구나 일정을 추가·수정할 수 있어요(공용).",
};

const BOARD: GuideTopic = {
  title: "강사 업무 보드",
  icon: "board",
  what: "할 일·진행중·완료 3칸으로 나뉜 공유 칸반. 강사들이 함께 업무를 관리해요.",
  steps: [
    "칸 위쪽에 제목을 적어 카드 추가",
    "카드를 누르면 설명·담당자·마감일·우선순위·태그를 입력",
    "카드를 옮겨(할 일→진행중→완료) 상태 변경 — 완료는 월별로 정리됨",
    "'내 담당만 보기'로 내 카드만 추려 보기",
  ],
  tip: "10초마다 자동 갱신되어 다른 강사의 변경이 거의 실시간으로 반영돼요.",
};

const MASTER: GuideTopic = {
  title: "학생 명단",
  icon: "students",
  what: "전 과목 공통 학생 명단. 학생을 검색해 프로필(시간표·기록·특이사항)을 열어볼 수 있어요.",
  steps: [
    "필터(전체/수학/영어/초등·중고등)와 상태(재원/휴원/퇴원)로 추려 보기",
    "학교·학년 필터, 이름 검색",
    "학생을 누르면 프로필 상세가 열림",
  ],
  tip: "강사는 조회 중심, 학년 자동채움·일괄 승급·정보 수정은 원장만 가능해요.",
};

const RANKING: GuideTopic = {
  title: "포인트 랭킹",
  icon: "chart",
  what: "학생 포인트 누적 순위. 출석·칭찬으로 쌓인 점수를 순위로 보여줘요.",
  steps: ["상위권 메달 표시", "학생명·학년·누적 포인트 확인", "차감(마이너스) 포인트는 빨간색으로 강조"],
};

const REQS: GuideTopic = {
  title: "시간표 변경",
  icon: "refresh",
  what: "1회성 시간표 변경을 기록하고, 다른 수업에 영향이 있으면 담당자에게 협의를 요청해요.",
  steps: [
    "'변경 기록' 탭: 학생·옮길 수업을 고르면 원래 날짜·시간이 자동 입력 → 변경할 날짜·시간만 지정(즉시 반영)",
    "다른 강사/과목과 겹치면 '변경 요청 보내기'로 사유와 함께 협의 요청",
    "'받은 요청'에서 승인·거절, '보낸 요청'에서 진행 상태 확인",
  ],
  tip: "받은 요청이 있으면 상단 종 아이콘과 사이드바에 숫자 배지가 떠요.",
};

const WIKI: GuideTopic = {
  title: "바꿈 매뉴얼",
  icon: "book",
  what: "학원 운영 매뉴얼 위키. 업무 방법·계정 정보 등을 함께 정리하고 찾아봐요.",
  steps: [
    "왼쪽 목록에서 문서 선택(중요도·상태·검색·정렬)",
    "본문의 표 칸을 누르면 내용이 클립보드에 자동 복사(ID/PW 복붙용)",
    "강사도 내용을 편집할 수 있고, 발행·상태 확정은 원장이 함",
  ],
};

const SNS: GuideTopic = {
  title: "SNS 관리",
  icon: "copy",
  what: "블로그·인스타·카톡채널 콘텐츠를 기획하고 업로드 진행 상황을 추적해요.",
  steps: [
    "게시글 작성 — 제목·본문·채널(다중 선택)·이미지 첨부",
    "상태로 진행 추적: 업로드 대기 → 완료(완료 시 링크 입력)",
    "데스크가 본문을 복사해 실제 채널에 올린 뒤 '완료' 처리",
  ],
};

const ISSUES: GuideTopic = {
  title: "오류·개선 요청",
  icon: "clipboard",
  what: "앱을 쓰다 발견한 오류나 개선 아이디어를 남기는 곳. 누구나 작성할 수 있어요.",
  steps: [
    "화면 선택(선택)·내용 입력·스크린샷 첨부 후 등록",
    "상태(신규/해결중/완료)로 진행 확인",
    "처리(상태 변경)는 원장이 함",
  ],
};

const MSG_SEND: GuideTopic = {
  title: "학생에게 메시지 보내기",
  icon: "megaphone",
  what: "공지·숙제 알림 등을 학생에게 단체/개별 발송해요. 학생은 1회 답장할 수 있어요.",
  steps: [
    "로그인 가능한 학생 목록에서 받는 학생 선택(전체 선택 가능)",
    "메시지 본문을 적고 보내기",
    "발송 기록에서 읽음·답장 현황 확인",
  ],
  tip: "원장·수학 담당만 보이는 메뉴예요. 학생 답장이 오면 빨간 배지로 알려줘요.",
};

/* ---------------- 수학 수업관리 ---------------- */

const MATH_GROUP: GuideGroup = {
  label: "수학 수업관리",
  topics: [
    {
      title: "오늘",
      icon: "today",
      what: "오늘 등원하는 학생의 출결·태도·숙제·진도를 한 화면에서 빠르게 입력하는 핵심 화면.",
      steps: [
        "왼쪽 학생 카드를 누르면 오른쪽에 입력창이 열림",
        "출석/지각/결석 표시(지각은 분 입력), 수업 태도 선택",
        "마감 숙제에 완성도(%) 입력 → 검사완료, 또는 '지연'으로 다시 검사할 날 지정",
        "다음 숙제 내주기(마감일·영역 선택), 진도 입력",
      ],
      tip: "출석 처리하면 포인트가 자동 적립돼요.",
    },
    { title: "시간표", icon: "cal", what: "수학 주간 시간표(정규 수업+보강)를 한눈에.", steps: ["주 선택(지난주~다음주)", "시간대별 수업 블록·공휴일 표시"] },
    {
      title: "대시보드",
      icon: "dashboard",
      what: "월별 재적 현황과 월말 정산(인센티브) 요약.",
      steps: ["월 선택", "요일별 분포·재적·신규·인센티브 대상 등 확인", "'리포트 복사'로 카톡에 붙여넣을 정산 텍스트 복사"],
    },
    {
      title: "출결 기록",
      icon: "clipboard",
      what: "출결을 날짜별로 모아 보고 수정·검색. (오늘 입력은 '오늘'에서)",
      steps: ["날짜 선택 후 1=출석·2=지각·3=결석 단축키로 빠르게 입력, Enter로 다음 학생", "월별 기록을 학생·상태로 필터해 조회"],
    },
    { title: "숙제 기록", icon: "book", what: "숙제 검사 기록을 월별로 모아 보고 표에서 바로 수정.", steps: ["월 선택, 학생·상태(검사완료/검사전/지연) 필터", "표 칸을 눌러 교재·완성도·메모 수정", "직접 추가도 가능"] },
    { title: "진도 기록", icon: "chart", what: "학생별 진도(진행중/완료)를 관리.", steps: ["전체/진행중/완료 탭, 학생 필터", "표에서 단원·영역·진행률·메모 수정", "'중복 정리'로 같은 단원 중복 건 정리"] },
    { title: "테스트 기록", icon: "cap", what: "주간평가·경시대회 등 테스트 기록 관리.", steps: ["월 선택, 학생·상태 필터", "유형·회차·범위·점수·상태 입력"], tip: "완료한 테스트 점수는 월말리포트에 자동 반영돼요." },
    {
      title: "학생 관리",
      icon: "students",
      what: "수학 담당 학생 목록을 관리.",
      steps: ["'새로고침'으로 노션 명단과 동기화", "학생 추가, 표 칸을 눌러 이름·학교·구분·상태 즉시 수정", "상세 버튼으로 시간표·수업료 편집"],
    },
    {
      title: "보강 관리",
      icon: "refresh",
      what: "결석 학생의 보강을 대기 → 예정 → 완료로 관리.",
      steps: ["대기 중인 결석에 보강 일정 잡기(스케줄)/미진행(스킵)", "예정 보강을 '완료' 처리하면 출석 기록 생성", "결석·보강을 수동으로 추가도 가능"],
    },
    {
      title: "수학 월말리포트",
      icon: "fileText",
      what: "학생별 월말 평가 리포트를 작성하고 이미지로 저장(한글·영문 2장).",
      steps: ["월 선택 후 보낼 학생 선택", "종합 코멘트·평가·출결 특이사항 입력(숙제·진도·테스트는 기록에서 자동 반영)", "'일괄 이미지 저장'으로 PNG 다운로드"],
    },
    { title: "연간 수업 계획표", icon: "cal", what: "분기·월별 연간 수업 계획을 한 표에서 관리. 수업 계획은 수학 강사가 정해요.", steps: ["연도 이동", "카테고리(학기 진도·시험대비·특강 등)×월 칸에 일정 입력", "이번 달은 파란색 강조"], tip: "수학 강사·원장 모두 편집할 수 있어요." },
  ],
};

/* ---------------- 영어 수업관리 ---------------- */

function engGroup(band: "mid" | "elem"): GuideGroup {
  const isElem = band === "elem";
  const topics: GuideTopic[] = [
    {
      title: "오늘",
      icon: "today",
      what: "영어 등원 학생의 일일기록을 작성하는 핵심 화면. 출결·숙제·진도·포인트를 한 건에 모아 기록해요.",
      steps: [
        "왼쪽 예정 학생을 누르면 오른쪽 일일기록이 열림",
        "출석/지각/결석(사유) 표시, 수업 목표·교재·단어시험 입력",
        "숙제 입력·검사(단어/독해/문법), 포인트 사유 추가",
        isElem ? "'오늘 한 것' 항목 체크(초등 전용), 특이사항·메모 입력" : "수업 태도·특이사항·메모 입력",
      ],
      tip: "입력은 자동 저장돼요(약 15초).",
    },
    { title: "시간표", icon: "cal", what: "영어 주간 시간표(정규+보강) 조회.", steps: ["주 선택", "요일별 수업 블록 표시"] },
    { title: "출결 기록", icon: "clipboard", what: "일일기록의 출결만 월별로 모아 보기.", steps: ["월 선택, 학생·상태 필터", "출석/지각/결석 현황 표"] },
  ];
  if (!isElem) topics.push({ title: "숙제 기록", icon: "book", what: "일일기록의 숙제 완료 현황(월별).", steps: ["월 선택", "학생별 숙제(단어/독해/문법) 현황 표"] });
  if (isElem)
    topics.push(
      { title: "커리큘럼", icon: "clipboard", what: "학생별 학습 로드맵(커리큘럼)을 편집. 학생 화면에 그대로 보여요.", steps: ["학생 선택", "섹션·항목별 학습 내용 추가·수정"] },
      { title: "오늘 한 것 수정", icon: "check", what: "초등영어 '오늘 한 것' 선택 항목을 관리.", steps: ["기본 목록 + 학생별/학원 전체 커스텀 항목 추가·삭제"] }
    );
  topics.push(
    { title: "진도 기록", icon: "chart", what: "영어 커리큘럼 진행 현황 기록.", steps: ["학생 선택", "진도 레벨·완료도(%) 입력"] },
    { title: "테스트 기록", icon: "cap", what: "영어 평가/시험 기록.", steps: ["학생별 테스트 종류 선택", "점수·통과 여부 입력"] },
    { title: "보강 관리", icon: "refresh", what: "영어 보강을 대기 → 예정 → 완료로 관리(수학과 동일).", steps: ["일정 지정·완료 처리·미진행 표시"] },
    { title: "대시보드", icon: "dashboard", what: "영어 강사 공지·현황 게시판.", steps: ["공지 작성·수정·삭제(본인 글)"] }
  );
  if (isElem) topics.push({ title: "영어 월말리포트", icon: "fileText", what: "영어 성적표 이미지를 일괄 저장(초등).", steps: ["대상 학생 선택", "리포트 이미지 저장"] });
  return { label: isElem ? "영어 수업관리 (초등)" : "영어 수업관리 (중고등)", topics };
}

/* ---------------- 데스크 ---------------- */

const DESK_GROUP: GuideGroup = {
  label: "데스크",
  topics: [
    { title: "오늘", icon: "today", what: "지금 등원·지각·결석 현황을 자동 집계해 보여줘요.", steps: ["수학·영어 통합 현황 확인"] },
    { title: "전체 시간표", icon: "cal", what: "수학·영어를 합친 전체 주간 시간표 조회.", steps: ["요일·시간별 수업 확인"] },
    { title: "학생 정보", icon: "students", what: "학생 명단 조회(학년·상태·연락처).", steps: ["검색·필터로 학생 찾기"] },
    { title: "강사 계정 리스트", icon: "users", what: "등록된 강사 계정을 조회.", steps: ["이름·역할 확인"] },
  ],
};

/* ---------------- 원장 전용 ---------------- */

const ADMIN_GROUP: GuideGroup = {
  label: "원장 전용",
  topics: [
    {
      title: "원장 대시보드",
      icon: "dashboard",
      what: "강사들이 입력한 기록을 모아 학원 전체 현황을 한눈에.",
      steps: ["월 이동", "총 재원·신규·지각·결석 KPI 확인", "지각·결석 상세, 최근 특이사항 피드", "학생 이름으로 영수 통합 기록 열람"],
    },
    {
      title: "강사 관리",
      icon: "users",
      what: "강사 계정을 만들고 역할·화면 권한을 배정해요.",
      steps: ["새 계정: 이름·역할·비밀번호(숫자 4자리+)·담당 과목 입력", "역할을 고르면 기본 화면셋 자동 선택(이후 체크박스로 조정)", "기존 계정의 비밀번호 변경·삭제"],
      tip: "여기서 켜고 끈 '화면 권한'이 그 계정 사이드바에 그대로 반영돼요.",
    },
    {
      title: "설정",
      icon: "gear",
      what: "학원 로고·수업 구분·공지 배너·데이터 가져오기를 관리.",
      steps: ["로고 업로드·크기 조절", "수업 구분(카테고리) 추가·색상·순서", "공지 배너 게시(강사/전체, 공지/중요)", "노션에서 학생·기록 가져오기"],
    },
  ],
};

/* ---------------- 역할별 가이드 조립 ---------------- */

/** 공통 그룹(역할별로 포함 항목이 조금씩 다름). */
function commonGroup(opts: { master?: boolean; wiki?: boolean; sns?: boolean }): GuideGroup {
  const topics: GuideTopic[] = [];
  if (opts.master) topics.push(MASTER);
  topics.push(RANKING, REQS);
  if (opts.wiki) topics.push(WIKI);
  if (opts.sns) topics.push(SNS);
  topics.push(ISSUES);
  return { label: "공통", topics };
}

function topGroup(board: boolean): GuideGroup {
  return { label: "기본", topics: board ? [HOME, SCHEDULE, BOARD] : [HOME, SCHEDULE] };
}

export const GUIDES: Record<Exclude<Role, "developer">, RoleGuide> = {
  admin: {
    title: "원장 사용 가이드",
    summary: "원장은 모든 화면을 보고, 강사 계정·화면 권한·학원 설정을 관리합니다. 수학·영어 수업관리 전체와 원장 전용 화면을 사용할 수 있어요.",
    start: "로그인하면 중고등 영어 '오늘' 화면으로 바로 들어갑니다. 왼쪽 사이드바에서 모든 메뉴를 카테고리별로 볼 수 있어요.",
    groups: [
      topGroup(true),
      MATH_GROUP,
      engGroup("mid"),
      engGroup("elem"),
      commonGroup({ master: true, wiki: true, sns: true }),
      { label: "학생 메시지", topics: [MSG_SEND] },
      ADMIN_GROUP,
    ],
  },
  math: {
    title: "수학 강사 사용 가이드",
    summary: "수학 강사는 담당 학생의 출결·숙제·진도·테스트를 기록하고 보강·월말리포트를 관리합니다.",
    start: "로그인하면 수학 '오늘' 화면으로 바로 들어갑니다. 여기서 오늘 등원 학생의 출결·숙제를 입력하세요.",
    groups: [topGroup(true), MATH_GROUP, commonGroup({ master: true, wiki: true }), { label: "학생 메시지", topics: [MSG_SEND] }],
  },
  english_mid: {
    title: "영어 강사(중고등) 사용 가이드",
    summary: "중고등 영어 강사는 일일기록(출결·숙제·진도·테스트)을 작성하고 보강을 관리합니다.",
    start: "로그인하면 영어 '오늘' 화면으로 바로 들어갑니다. 등원 학생의 일일기록을 작성하세요.",
    groups: [topGroup(true), engGroup("mid"), commonGroup({ master: true, wiki: true })],
  },
  english_elem: {
    title: "초등영어 강사 사용 가이드",
    summary: "초등영어 강사는 일일기록과 '오늘 한 것', 커리큘럼을 관리하고 월말리포트를 저장합니다.",
    start: "로그인하면 영어 '오늘' 화면으로 바로 들어갑니다. 등원 학생의 일일기록과 '오늘 한 것'을 입력하세요.",
    groups: [topGroup(true), engGroup("elem"), commonGroup({ master: true, wiki: true })],
  },
  desk: {
    title: "데스크 사용 가이드",
    summary: "데스크는 전체 시간표·학생·강사 계정을 조회하고, 학원 일정과 SNS 업로드를 도와요(조회 중심).",
    start: "로그인하면 데스크 '오늘' 화면으로 들어갑니다. 현재 등원 현황을 바로 확인하세요.",
    groups: [topGroup(true), DESK_GROUP, commonGroup({ master: true, wiki: true, sns: true })],
  },
  student: {
    title: "학생 사용 안내",
    summary: "학생은 본인의 시간표·커리큘럼을 확인하고, 수업 일지를 쓰고, 선생님 메시지를 받아요.",
    start: "로그인하면 본인 페이지가 열립니다. 위쪽에는 메시지(종 아이콘)와 오류 신고 버튼이 있어요.",
    groups: [
      {
        label: "내 화면",
        topics: [
          { title: "내 정보·시간표", icon: "students", what: "맨 위에 내 사진·학년·학교가 보이고, 그 아래 내 수업 시간표가 요일별로 나와요." },
          { title: "커리큘럼", icon: "clipboard", what: "선생님이 짜준 학습 로드맵을 볼 수 있어요(보기 전용).", steps: ["섹션별 학습 항목과 내용 확인"] },
          {
            title: "수업 일지",
            icon: "book",
            what: "오늘 수업에서 배운 것·숙제 등을 기록해요.",
            steps: ["오늘 목표·내용·감상·숙제 입력", "자동 저장돼요", "지난 일지도 다시 볼 수 있어요"],
          },
          {
            title: "메시지 (종 아이콘)",
            icon: "bell",
            what: "선생님이 보낸 공지·알림을 받아요.",
            steps: ["새 메시지가 오면 종에 숫자 배지가 떠요", "메시지함을 열어 확인", "한 번 답장할 수 있어요"],
          },
          { title: "오류 신고", icon: "alert", what: "앱이 이상하면 '오류 신고' 버튼으로 알려줄 수 있어요.", steps: ["내용을 적어 등록"] },
        ],
      },
    ],
  },
};

/** 화면에서 쓸 역할 목록(원장이 탭으로 전환). developer는 admin과 동일. */
export const GUIDE_ROLES: Exclude<Role, "developer">[] = ["admin", "math", "english_mid", "english_elem", "desk", "student"];

/** 이 사용자가 볼 기본 가이드 역할. */
export function guideRoleFor(role: Role): Exclude<Role, "developer"> {
  return role === "developer" ? "admin" : role;
}
