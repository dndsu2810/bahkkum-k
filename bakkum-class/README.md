# 바꿈영수학원 · 수업 관리 (bakkum-class)

원장용 수업 관리 도구. `hyeon's memo` 디자인 핸드오프(HTML 프로토타입)를 **Vite + React + TypeScript**로 픽셀 단위 재현하고, 데이터는 **Cloudflare D1**에 저장합니다.

## 기능

- **대시보드** — 월별 재적 KPI, 요일별 수업 분포, 초/중등 도넛, 재적 학생 표, 보강 현황, **리포트 복사**(카톡 붙여넣기용)
- **출결 체크** — 출석/지각/결석/조퇴/무단결석/보강 6단계 · 지각 분 · 수업태도 · 특이사항.
  결석·무단결석·조퇴는 보강 대기 자동 등록, **출석 시 모각공 포인트 +20 자동 적립**(이름 매칭)
- **학생 관리** — 추가/수정(상태 재원·휴원·퇴원·대기 / 학교 / 생년월일 / 학부모·학생 연락처 / 수업 슬롯), 원장 내부 메모
- **시간표** — 주간 캘린더(겹침 자동 패킹), 초=파랑 / 중=보라 / 보강=주황 · 재원 학생만 표시
- **보강 관리** — 보강 대기 → 예정·완료 → 미진행 워크플로
- **숙제 관리 / 진도 관리** — 학생·날짜별 기록 CRUD. 기록이 월말리포트에 자동 누적
  (숙제=‘숙제 및 수행 기록’ 목록, 진도=‘진도 달성 현황’ 해당 월 최신 기록). 기록 시 노션 숙제/진도 DB에도 저장
- **월말리포트** — 학생 다중선택 + 월 선택. 출결 달력·출석현황은 D1에서 자동 집계,
  평가·숙제·진도·코멘트·특이사항은 폼에서 입력(localStorage 저장). teal 디자인 시트(768px)를
  html2canvas로 **PNG 2장(상/하) 자동 분할 저장**, 여러 학생 **일괄 저장** 지원

## 구조

```
bakkum-class/
  index.html            진입 HTML (Pretendard 웹폰트)
  src/
    main.tsx, App.tsx    앱 셸 + 라우팅(페이지 전환)
    store.tsx            전역 상태 + 토스트 + 모달 호스트
    api.ts               데이터 계층 (워커 있으면 /api, 없으면 localStorage)
    types.ts             도메인 타입
    lib/                 dates / logic(재적·보강 판정) / report(리포트 생성)
    components/          Header, Sidebar, charts, StudentTable, MakeupList, modals 등
    pages/               Dashboard, Attendance, Students, Timetable, Makeup
  worker/index.ts        Cloudflare Worker: 정적 자산 + /api/data(D1)
  schema.sql             D1 스키마
  wrangler.toml          Worker / D1 / 정적 자산 설정
```

## 개발

```bash
npm install
npm run dev            # http://localhost:5173 — 워커 없이 localStorage로 동작(프로토타입과 동일)
```

D1 백엔드까지 로컬에서 보려면:

```bash
npm run build                 # dist/ 생성 (워커가 서빙)
npm run db:local              # 로컬 D1에 스키마 적용
npm run wrangler:dev          # http://localhost:8787 — /api 가 로컬 D1로 동작
```

> 데이터 계층은 시작 시 `/api/health` 로 백엔드 유무를 감지합니다.
> 워커가 있으면 D1, 없으면 localStorage 로 자동 전환됩니다.

## 데이터 저장 (중요)

기존 `bakuum-production`(모각공/마법거울 라이브 D1)을 공유합니다.

- **학생 명단은 모각공 `students` 테이블과 공유**합니다(단일 명단). 앱은 명단을
  **읽고, 신규만 추가**(없는 이름이면 INSERT, 있으면 링크)하며 **절대 삭제/전체덮어쓰기 하지 않습니다.**
  학생 제거는 하드 삭제 대신 **상태 '퇴원'**(숨김)으로 처리합니다.
- 학년·등록일·상태·학교·생년월일·연락처·**시간표·출결·보강**은 모각공 students에 없으므로
  앱 전용 **`class_*` 테이블**(`class_students` 학사정보 / `class_lessons` / `class_attendance` / `class_makeups`)에
  학생 id로 매핑해 저장합니다. 풀스냅샷 저장은 `class_*`만 건드립니다.
- **출석/지각 시 포인트 +20**은 모각공 `point_history`에 학생 id로 INSERT + `students.points` 동기화.
- `attendance_log_v2`(선생님 출퇴근) · `student_schedules` · `consultations`는 사용/변경하지 않습니다.

데모 시드 없음 — 명단은 모각공 students에서 옵니다.

## 노션 양방향 연동

- **노션 → 앱**: 학생 관리 "노션에서 학생 동기화" → `GET /api/sync/students`가 노션 학생 DB(재원)를
  읽어 `students`에 upsert(notion_page_id 기준, 삭제 없음). 학사필드(상태·학교·생년월일·연락처·첫수업일)는
  students 컬럼에 저장(migration 002).
- **앱 → 노션(best-effort)**: 출결 체크 시 출결 DB, 월말리포트 폼의 "노션 저장" 버튼으로 숙제/진도 DB에
  행 추가. 학생 연결은 notion_page_id(relation). 노션 저장 실패해도 D1은 정상 동작.
- 설정: Worker 시크릿 `NOTION_TOKEN` + 노션에서 4개 DB를 Integration에 연결 + `worker/notion.ts`의
  `NOTION_CFG` 속성명을 실제 노션 속성명에 맞추기. 자세한 절차는 `DEPLOY.md`.

## 배포

`DEPLOY.md` 참고.
