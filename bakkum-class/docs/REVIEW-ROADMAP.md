# 바꿈영수학원 통합 관리 앱 — 구조·로드맵 (리뷰용)

> 목적: 전반적인 오류 체크 + UI/UX 개선 리뷰를 위한 **화면별 구조 지도**.
> 작성 기준일: 2026-06-23 · 앱 이름: **쏘이지(Soez)** · 배포: `https://bakkum-class.dndsu2810.workers.dev`

---

## 0. 한눈에 보기

- **프론트엔드**: Vite + React + TypeScript (SPA). 진입점 `src/main.tsx → Hub.tsx`.
- **백엔드**: Cloudflare Worker (`worker/index.ts`) + **D1**(SQLite) + **R2**(이미지/미디어).
- **외부 연동**: Notion(출결·숙제·진도·테스트 동기화), 솔라피/카카오(등하원 알림 — 현재 보류/테스트), OpenAI·Anthropic(회의록 요약).
- **인증**: 강사=이름+PIN, 학생=이름+생년월일. 세션 쿠키. 역할(Role)·화면권한(scope)으로 사이드바 구성.

### 데이터 흐름 2갈래 (중요 — 버그·일관성 리뷰 포인트)
1. **수학 로컬 스토어** (`src/store.tsx`, `DataSnapshot`) — 수학 출결·숙제·진도·테스트·보충. **병합 저장(upsert + deletions)** 으로 여러 강사 동시편집 대응. `localStorage` 캐시 + `/api/data` 동기화.
2. **영어 워커 API** (`src/lib/engApi.ts`) — 영어 일일기록(`EngDaily`)·테스트(`EngTest`)·진도. D1 직접 read/write.

> ⚠️ 수학과 영어는 **데이터 모델·저장경로가 완전히 다름**. 비슷해 보이는 화면이라도 내부가 다르므로 한쪽 수정이 다른 쪽에 자동 반영되지 않음.

---

## 1. 진입 라우팅 (`src/Hub.tsx`)

| 조건 | 화면 |
|---|---|
| URL `#kiosk` | `CheckinKiosk` — 로그인 없는 등하원 키오스크(태블릿) |
| 로딩 중 | `AuthSplash` |
| 미로그인 | `Login` |
| `role === "student"` | `StudentHome` (학생 화면) |
| 그 외(스태프) | `Workspace` (역할별 사이드바 + 본문) |

- **역할(Role)**: `admin`(원장) · `developer`(개발자=admin 권한) · `math` · `english_mid` · `english_elem` · `desk` · `student`.
- **화면권한(AreaKey)**: `students/math/eng_mid/eng_elem/desk/notes/board/wiki/sns/report` — 원장이 계정별로 on/off (`scope`). `areasForUser()`가 실제 노출 결정.

---

## 2. 사이드바 구조 (`src/lib/workspace.tsx` · `sidebarFor()`)

역할/권한에 따라 그룹이 조립됨. 본문 라우팅은 `src/Workspace.tsx`의 `Body(view)` switch.

| 그룹 | 항목(키) | 비고 |
|---|---|---|
| (상단·무제목) | 홈 · 학원 일정 · 업무 보드 · 공지사항 | board 권한 시 업무보드 |
| 수학 수업관리 | **오늘** · **대시보드** · 시간표 · **강사 대시보드** · 출결 기록 · 숙제 기록 · 진도·교재관리 · 테스트 기록 · 학생 관리 · 보강 관리 · 수학 월말리포트 · 연간 수업 계획표 | math 권한 |
| 영어 수업관리 (중고등) | 오늘 · 시간표 · 출결 · 숙제 · 내신모드 · 진도 · 테스트 · (현황=대시보드) | english_mid/admin |
| 영어 수업관리 (초등) | 오늘 · 시간표 · 출결 · 오늘 뭐해요? · 오늘 한 것 수정 · 진도 · 테스트 · 대시보드 · 월말리포트 | english_elem/admin |
| 공통 | 학생 명단 · 전체 시간표 · **강사 정보 안내** · 포인트 랭킹 · 포인트 항목 · 자료 배부 · 교재·비품 주문 · 변경 요청 · 매뉴얼(wiki) · SNS · 회의록 · 오류·개선 요청 · 사용 가이드 | 권한별 가감 |
| 등하원 | 등하원 관리 · 수업시간 리포트 | 전체 |
| 학생 메시지 | 학생에게 메시지 보내기 | admin/math |
| 원장 전용 | 원장 대시보드 · 강사 관리 · 설정 | admin |

> 🔧 이번 세션 변경: **데스크 전용 그룹 제거**(데스크 정보는 공통으로 이동). **강사 계정 리스트 → 강사 정보 안내**(공통).
> 페이지 ID 정리: `today`(오늘) · `classdash`(대시보드) · `dashboard`(강사 대시보드).

---

## 3. 화면별 상세

### 3-A. 수학 수업관리

#### ① 오늘 — `src/pages/Today.tsx` (`view=today`)
- **레이아웃**: 좌우 마스터-디테일(왼쪽 학생목록 / 오른쪽 상세).
- **기능**: 날짜 이동, 학년탭(전체/초등/중등), 출결(출석·지각·결석·조퇴·무단결석)+되돌리기·전체출석, 수업태도, 검사할 숙제(완성도·검사완료·지연), 내줄 숙제(영역태그·마감일), **시험(오늘 본 시험+다음시험 예약)**, **1:1 보충학습**.
- **공용 컴포넌트**: `<TodayTests>` `<SupLearn>` (대시보드와 공유).
- 출결 시 **결석→다음 등원일로 숙제 이월**, 출석으로 바꾸면 복원. 포인트 적립(`awardPoints`)·Notion 동기화.

#### ② 대시보드 — `src/pages/TodayDashboard.tsx` (`view=classdash`)
- **레이아웃**: 중고등영어와 동일한 **세로 카드형**(접힘 시 블러 미리보기, 펼치면 입력).
- 카드 요약줄: 이름 + **누적기록(차트) 버튼**(`MathMonthlyModal`) + 출결·교재·숙제검사·시험 배지 + **하원** 토글.
- 상단: 학년탭, **등원 칩(누르면 카드로 점프)**, **등원 학생 추가 검색**(예정에 없어도 추가 → ‘추가’ 배지).
- 카드 내부 입력 = 오늘과 동일(출결·태도·숙제·시험·보충).
- 하원 = 카드 접고 맨 아래로(이 화면 한정, 새로고침 시 초기화).

#### ③ 강사 대시보드 — `src/pages/Dashboard.tsx` (`view=dashboard`)
- 학원 통계(재적/구분별/인센티브 정산), 월 선택, **재원 학생 표(클릭 시 학생 상세 모달)**.

#### ④ 출결 기록 — `src/pages/Attendance.tsx`
- 날짜별 출결 누적 조회·수정. (입력은 ‘오늘’에서)

#### ⑤ 숙제 기록 — `src/pages/Homework.tsx`
- 학생·월별 숙제 기록 조회. (입력은 ‘오늘’에서)

#### ⑥ 진도·교재관리 — `src/pages/Progress.tsx`
- 학생별 교재 진도(시작일·진행중/완료). **행 인라인 수정**(교재명·범위·시작일) + 삭제.

#### ⑦ 테스트 기록 — `src/pages/Tests.tsx`
- 2단(학생목록/입력). 평가 종류·시험일·회차·범위·상태·**점수(점수/만점/갯수 토글)**.
- 레코드 = **2줄 카드**(상단 정보·상태·수정·삭제 / 하단 점수). **수정**(시험명·회차·범위·날짜, 노션 미반영) · 삭제.

#### ⑧ 수학 월말리포트 — `src/pages/Report.tsx` → `ReportPreview` → `components/ReportCard.tsx`
- **2단 레이아웃**(좌측 학생목록+검색+일괄저장 체크 / 우측 입력).
- 자동 집계: 출결·숙제·진도·평가(testLog)·**출결 특이사항**.
- 수동 입력: 선생님 코멘트 · **1:1 보충학습**(보충일시·시간·보충명·학습내용·보충사유·비고 — `SupLog` 통합, 오늘/대시보드와 같은 데이터).
- **지연검사완료**: ‘원래 마감 N/N · 검사 N/N’ 표시(연한빨강+진한빨강). 색/문구 최근 조정.
- 미리보기 → **이미지 2장(상/하) 저장**(html2canvas). 일괄 저장 지원.

#### ⑨ 시간표 — `Timetable.tsx` / ⑩ 학생 관리 — `Students.tsx` / ⑪ 보강 관리 — `Makeup.tsx` / ⑫ 연간 수업 계획표 — `LessonPlan.tsx`

---

### 3-B. 영어 수업관리 (`src/screens/English.tsx`, band=mid/elem)
- 사이드바에서 탭 선택(화면 내 탭바 없음). `tab`: today/att/hw/progress/test/board/cur/items/naesin/makeup/tt.
- **현황(board=대시보드)**: `EngInputDash`(카드형, 중고등) / 초등도 카드형으로 통일.
  - 카드: 접힘 블러 미리보기 + **누적기록(차트) 버튼**(`StudentMonthlyModal`) + **하원** + 등원 칩(점프).
- **오늘**: 일일기록(학습목표·숙제3분류·단어시험·코멘트). 초등은 원서진도·오늘한것·단어시험.
- 진도/테스트: 좌우 마스터-디테일. 테스트 = `EngTest`(점수/만점/통과·재시·재시험 날짜).
- 내신모드: 자유 숙제 + 배부자료 기준.
- 데이터: **모두 워커 API(`engApi`)**, 수학과 별개.

---

### 3-C. 공통

| 화면 | 파일 | 메모 |
|---|---|---|
| 학생 명단 | `StudentMaster.tsx` | 전과목 공통 마스터(인라인 수정) |
| 전체 시간표 | `TimetableAll.tsx` | 수학·영어 통합 |
| **강사 정보 안내** | `TeacherGuide.tsx` | **표 형태**: 강사명·담당과목(수학/영어중고등/영어초등/데스크)·추가 업무담당·전화번호. 연락처 `tel:` 바로걸기. **강사 누구나 편집**(config 저장, worker 권한 `teacher_info`). |
| 포인트 랭킹/항목 | `PointRanking.tsx` / `PointCatalog.tsx` | 적립·시상 |
| 자료 배부 | `Materials.tsx` | 배부↔일지 연동 |
| 교재·비품 주문 | `Orders.tsx` | 주문 관리 |
| 변경 요청 | `ChangeRequests.tsx` | 시간표 변경 승인(실시간) |
| 회의록 | `Meetings.tsx` | 음성/텍스트 AI 요약(Whisper+Claude) |
| 오류·개선 요청 | `IssueBoard.tsx` | 화면 선택 + **직접 입력** · 스크린샷 · 원장 상태변경/답변 |
| 사용 가이드 | `Guide.tsx` | 역할별 안내(`lib/guide.ts`) |
| 공지사항 | `Notices.tsx` / 업무 보드 | `BoardShared.tsx`(칸반) |
| 매뉴얼/SNS | `Wiki.tsx` / `Sns.tsx` | |

---

### 3-D. 등하원 / 원장 전용
- **등하원**: `Checkin.tsx`(관리) · `CheckinKiosk.tsx`(`#kiosk` 키오스크) · `CheckinReport.tsx`(수업시간 리포트). 출석번호=온라인ID, 솔라피 발송 보류.
- **원장 전용**: `AdminDashboard.tsx`(원장 대시보드) · `AdminAccounts.tsx`(강사 관리=계정 CRUD·권한·PIN) · `Settings.tsx`(로고·카테고리·메뉴 순서·시크릿키).

---

### 3-E. 학생 화면 — `src/screens/StudentPage.tsx` (`StudentHome`)
- 학생 로그인(이름+생년월일) 후 진입. 본인 기록만 조회.
- 구성:
  - **프로필/시간표**(`Timetable`)
  - **커리큘럼 보기**(`CurriculumView`) + **자기주도학습 입력**(`SelfLearning`)
  - **일일기록**: 강사가 낸 숙제 검사 체크(양방향), 오늘의 숙제 직접 추가, 학습목표 체크, 선생님 코멘트(읽기), 학생→선생님 메모.
  - **기록 이력**(`LogHistory`, 월별) — 출결·숙제·시험.
  - **학생 메시지**(`StudentMessages`): 선생님→학생 알림 + 답장 1회.
- 데이터: 영어 일일기록(`engApi`) 기반 + 학생 전용 엔드포인트(`/api/student/*`).

---

## 4. 데이터 모델 요약

### 수학 로컬 스토어 — `DataSnapshot` (`src/types.ts`)
`students · makeups · attendance · homeworkLog · progressLog · testLog · supplements · tasks · dismissedMakeups · noHomework · deletions`
- **TestLog**: `score(환산0~100) · status(예정/완료) · scoreMode(score/max/ratio) · scoreNum · scoreDen · type · round · range · memo`.
- **HwLog**: `status(pending/done/late) · completion · delayCount · recheckDate · carriedFrom · checkedDate`.
- **SupLog(=1:1 보충학습)**: `date · minutes · reason · name · content · note`.
- 저장: 병합(upsert + `deletions`)으로 동시편집 안전.

### 영어 워커 데이터 — `engApi`
- **EngDaily**(출결·목표·숙제3분류·코멘트·내신 자유숙제…), **EngProgress**, **EngTest**(name·score·total·result·retakeOf).

### 설정 — `class_config`(K/V, admin 전용 쓰기, 단 `math_plan_*`·`teacher_info`는 예외 허용).

---

## 5. 워커 API 표면 (`worker/*`)
- 인증: `/api/auth/{login,logout,me}` · `/api/me/prefs`
- 수학 데이터: `/api/data`(스냅샷 read/merge) · `/api/students` · `/api/timetable` · `/api/today` · `/api/schedule`
- Notion 동기화: `/api/notion/{attendance,homework,progress,test}` · `/api/sync/*`
- 영어: `/api/eng/*` (daily·test·progress·ranking·point-reasons) · `/api/sync/eng-*`
- 공통: `/api/issue*` · `/api/meetings*` · `/api/orders*` · `/api/messages*` · `/api/notice*` · `/api/posts*`(공지) · `/api/reqs*`(변경요청) · `/api/tasks*`(보드) · `/api/notes*` · `/api/wiki*` · `/api/sns*` · `/api/materials*`
- 등하원: `/api/checkin*`
- 계정/설정: `/api/users{,/update,/delete}` · `/api/config` · `/api/upload`·`/api/files*`·`/api/media/*`(R2)
- 점수/포인트: `/api/points{,/catalog,/redeem}`
- 크론: 1분/매일 04시·12시(브리핑·정리·등하원봇 등).

---

## 6. 이번 세션 작업 로드맵 (완료)

1. **수학 대시보드 신설**(`TodayDashboard`, `classdash`) — 영어 카드형과 동일 구성(접힘 블러·누적기록 차트버튼·하원·점프칩).
2. **페이지 명칭/구조 정리** — 옛 ‘오늘’(마스터-디테일) 복원, 새 카드형=‘대시보드’, 기존 ‘대시보드’→‘강사 대시보드’.
3. **시험 입력 통합**: `ScoreInput`(점수/만점/갯수 토글) · `lib/score`(computeScore/scoreLabel) · `TestLog`에 scoreMode/Num/Den · **TodayTests 공용 컴포넌트** · 다음시험 예약(+범위) · **MathMonthlyModal**(누적기록).
4. **테스트 기록**: 2줄 카드 UI · 수정/삭제(노션 미반영).
5. **진도·교재관리**: 인라인 수정 추가.
6. **1:1 보충학습 통합**: `SupLog` 확장 + **SupLearn 공용 컴포넌트** + 월말리포트 자동 반영(오늘/대시보드/리포트 동일 데이터) + 표시(줄바꿈)·입력(학습내용·보충사유 넓게/비고 작게) 레이아웃 개선.
7. **월말리포트 개편**: 2단 레이아웃 · 1:1 보충학습 섹션 · **지연검사완료**(checkedDate·원래마감 표시·빨강 색) · 평가/특이사항 입력칸 제거(자동) · 좌측 간격.
8. **지연 숙제 로직**: `checkedDate` 기록 + ‘지연검사완료’ 라벨(오늘/대시보드/리포트).
9. **강사 정보 안내** 신설(표·전화걸기·강사 누구나 편집) + **데스크 사이드바 제거**.
10. **강사 대시보드** 재원학생 클릭 → 상세 모달.
11. **오류·개선 요청** 화면 직접 입력.
12. **등원 학생 추가**(검색, 예정에 없어도) — 대시보드.
13. UI 잔손질: 영어 카드 잘림(줄바꿈 통일) · 거대 아이콘 축소 · 점프칩 정리 등.

---

## 7. 리뷰 시 중점 체크리스트 (제안)

### 정합성/버그
- [ ] 수학(로컬 스토어) ↔ 영어(워커) **데이터 경로 혼동** 없는지(비슷한 화면이 서로 다른 저장소).
- [ ] **‘오늘’ vs ‘대시보드’** 동일 입력이 같은 데이터에 쓰이는지(testLog·supplements·attendance·homeworkLog 공유 확인).
- [ ] **하원/extra 등원/openKeys**는 화면 한정 상태 → 새로고침 초기화가 의도대로인지.
- [ ] **지연 숙제 이월**(결석→다음 등원, checkedDate, 월별 리포트 귀속) 엣지케이스.
- [ ] **config 저장 권한**: `teacher_info`/`math_plan_*` 외 키는 강사 저장 시 403(무음 실패) — 안내 필요 화면 점검.
- [ ] 노션 동기화 누락/중복(테스트 수정은 노션 미반영 등 의도 일치 확인).
- [ ] 월말리포트 **이미지 저장(html2canvas)** 폰트·줄바꿈·잘림.

### UI/UX
- [ ] 카드형(대시보드)·마스터-디테일(오늘) 두 패턴 **공존 일관성**(같은 항목 같은 위치).
- [ ] 좁은 폭/모바일에서 입력 그리드(1:1 보충학습·시험·숙제) 찌그러짐.
- [ ] 학생 화면 가독성·양방향 체크 직관성.
- [ ] 색·배지 의미 통일(완료/지연/예정/하원/추가 등), 토스식 해요체 문구.
- [ ] 빈 상태/로딩/에러 메시지 일관성.

---

## 8. 핵심 파일 빠른 참조

| 영역 | 파일 |
|---|---|
| 진입/라우팅 | `src/Hub.tsx` · `src/Workspace.tsx` · `src/screens/MathContent.tsx` |
| 사이드바/페이지ID | `src/lib/workspace.tsx` · `src/lib/nav.ts` |
| 수학 데이터 | `src/store.tsx` · `src/api.ts` · `src/types.ts` |
| 영어 데이터 | `src/lib/engApi.ts` · `src/screens/English.tsx` |
| 시험/점수 | `src/components/{TodayTests,ScoreInput}.tsx` · `src/lib/score.ts` |
| 보충/리포트 | `src/components/{TodayTests(SupLearn),ReportCard}.tsx` · `src/pages/Report.tsx` · `src/lib/report*.ts` |
| 학생 화면 | `src/screens/StudentPage.tsx` |
| 권한/역할 | `src/lib/roles.ts` · `src/auth.tsx` |
| 워커 | `worker/index.ts`(+ `eng/feedback/meeting/orders/post/checkin*` 등) |
