# 배포 가이드 — bakkum-class

이 앱은 **Cloudflare Worker 하나**가 (1) 빌드된 SPA(`dist/`)와 (2) `/api/*`(D1)를 함께 서빙합니다.

> **D1**: 새로 만들지 않고 기존 `bakuum-production`(모각공/마법거울 라이브 DB)을 공유합니다.
> 단, 이 앱은 **`class_*` 테이블만** 사용하며 모각공 기존 테이블(students, student_schedules,
> attendance_log_v2 등)은 절대 읽거나 쓰지 않습니다. 스키마 적용은 전부 `CREATE TABLE IF NOT EXISTS`
> (추가만) 이라 기존 데이터에 영향이 없습니다. 시드(데모 데이터) 없음 — 빈 상태로 시작합니다.

## 1. (최초 1회) 의존성 + 로그인

```bash
cd ~/Desktop/bahkkum-k/bakkum-class
npm install
wrangler login        # 이미 로그인돼 있으면 생략 (wrangler whoami 로 확인)
```

## 2. class_* 테이블 생성 (추가 전용, 안전)

```bash
npm run db:remote     # = wrangler d1 execute bakuum-production --remote --file=./schema.sql
```

## 2-b. (기존 설치 업데이트 시) 마이그레이션

이미 한 번 배포한 뒤 기능을 추가한 경우, 늘어난 컬럼을 기존 class_* 테이블에 반영:

```bash
# 학생 상태/학교/생년월일/연락처 + 출결 상세(지각분·태도·특이사항·포인트적립) 컬럼 추가
npx wrangler d1 execute bakuum-production --remote --file=./migrations/001_extend.sql
```
> `ADD COLUMN`은 IF NOT EXISTS가 없어 **딱 한 번만** 실행. class_* 테이블만 변경(모각공 무관).

## 2-c. (노션 연동 사용 시) 마이그레이션 + 환경변수 + DB 공유

1) 학사필드를 students 테이블로 옮기는 마이그레이션 (1회):
```bash
npx wrangler d1 execute bakuum-production --remote --file=./migrations/002_notion.sql
```
2) NOTION_TOKEN 시크릿 등록 (노션 Internal Integration 토큰):
```bash
npx wrangler secret put NOTION_TOKEN     # 프롬프트에 토큰 붙여넣기
```
   - 로컬 테스트는 `.dev.vars`에 `NOTION_TOKEN=secret_xxx` 한 줄.
3) 노션에서 **4개 DB를 해당 Integration에 "연결(Share)"** 해야 API가 접근합니다
   (학생 DB / 수업기록·출결 DB / 숙제 DB / 진도 DB 각각 ··· → 연결 → 통합 선택).
4) **속성명 확인**: `worker/notion.ts`의 `NOTION_CFG`는 스펙의 한글 라벨을 속성명으로
   가정합니다. 실제 노션 속성명/타입과 다르면 동기화/저장이 실패하니, 한 번 동기화해 보고
   `wrangler tail` 로그의 실패 메시지를 보고 `NOTION_CFG`를 맞춰 주세요. (노션 실패해도 D1은 정상)

## 3. 빌드 + 배포

```bash
npm run deploy        # = npm run build && wrangler deploy
```

## 출석 → 포인트 자동 적립 (모각공 연동 메모)

- 출결을 **출석**으로 찍으면 `POST /api/points`가 모각공 `students`에서 **같은 이름**을 찾아
  `point_history`에 `+20`(reason `출석`, category `learn`)을 넣고 `students.points`도 함께 +20.
- 이름이 모각공에 없으면 적립 건너뜀(출결 기록은 정상 저장). 출석을 다른 상태로 정정하면 `-20` 자동 회수.
- 모각공 불변식 `students.points == SUM(point_history.delta)` 유지. 모각공의 다른 테이블은 건드리지 않음.

배포 후 워커 URL(예: `https://bakkum-class.<subdomain>.workers.dev`)로 접속하면 빈 상태로 시작.
학생 화면에서 직접 등록하면 됩니다.

## 데이터 모델 메모

- 저장은 **풀 스냅샷** 방식: 화면에서 무언가 바꾸면 전체 상태를 `PUT /api/data` 로 보내
  `class_*` 테이블만 한 트랜잭션으로 교체합니다(다른 테이블은 건드리지 않음).
- `npm run dev`(Vite, 워커 없음)에서는 `/api/health` 감지 실패 → **localStorage** 로 동작(역시 빈 상태 시작).

## 롤백 / 정리

이 앱이 만든 것만 지우려면 `class_*` 테이블만 DROP 하면 됩니다(모각공 무관):

```sql
DROP TABLE IF EXISTS class_attendance;
DROP TABLE IF EXISTS class_makeups;
DROP TABLE IF EXISTS class_lessons;
DROP TABLE IF EXISTS class_students;
```
