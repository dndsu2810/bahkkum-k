# 바꿈영수학원 · 수업 관리 (bakkum-class)

원장용 수업 관리 도구. `hyeon's memo` 디자인 핸드오프(HTML 프로토타입)를 **Vite + React + TypeScript**로 픽셀 단위 재현하고, 데이터는 **Cloudflare D1**에 저장합니다.

## 기능

- **대시보드** — 월별 재적 KPI, 요일별 수업 분포, 초/중등 도넛, 재적 학생 표, 보강 현황, **리포트 복사**(카톡 붙여넣기용)
- **출결 체크** — 날짜별 수업 출/결석 체크. 결석 처리하면 보강 대기에 자동 등록
- **학생 관리** — 학생 추가/수정(요일·시간·분량 슬롯), 원장 내부 메모 플래그
- **시간표** — 주간 캘린더(겹침 자동 패킹), 초=파랑 / 중=보라 / 보강=주황
- **보강 관리** — 보강 대기 → 예정·완료 → 미진행 워크플로

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

기존 `bakuum-production`(모각공/마법거울 라이브 D1)을 **공유**하되, 이 앱은 충돌을 피하기 위해
**`class_*` 테이블만** 사용합니다(`class_students`, `class_lessons`, `class_attendance`, `class_makeups`).
모각공 기존 테이블은 절대 읽거나 쓰지 않습니다. 데모 시드 없음 — 빈 상태로 시작합니다.

## 배포

`DEPLOY.md` 참고.
