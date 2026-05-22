# ezssam 게임 허브

초등 5~6학년 대상, 몸으로 배우는 수학 게임 통합 페이지. (ezssam — 지현)

## 기술 스택

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS (하늘색 브랜드 팔레트)
- 폰트: Pretendard(한글), Inter(영문/숫자)
- 호스팅: Cloudflare Pages (배포 연결은 추후)
- 저장: localStorage (1단계) → D1 (추후 확장)

## 개발

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # 프로덕션 빌드 검증
```

## 폴더 구조

```
src/
  app/
    page.tsx              메인 허브 (게임 카드 그리드)
    welcome/page.tsx      첫 방문 이름 입력
    game/[gameId]/page.tsx  게임 자리 (placeholder, 추후 실제 게임)
    layout.tsx, globals.css
  components/             Header, GameCard, CategoryFilter, NameModal 등
  lib/                    student.ts(localStorage), games.ts(메타)
  data/games.json         게임 목록 (새 게임 = 여기에 한 줄 추가)
files/                    기획서 4종 (마스터 + 허브/웹캠/풍덩)
```

## 진행 단계

1. ✅ 허브 골격 (헤더 · 환영화면 · 카드 그리드 · 이름 저장 · placeholder)
2. 디자인 다듬기 + 결과화면/기록 데이터 흐름
3. 게임 1: 약수·배수 풍선 (MediaPipe Hands)
4. 게임 2: 분수 비교 (MediaPipe Pose)
5. 게임 3: 수학 풍덩 (MediaPipe Pose)
6. 마법 거울 (음성 인식 + 모각공 연동)
7. (선택) 학원용 확장
