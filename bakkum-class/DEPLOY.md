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

## 3. 빌드 + 배포

```bash
npm run deploy        # = npm run build && wrangler deploy
```

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
