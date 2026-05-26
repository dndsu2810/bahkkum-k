# 배포 방법 (나중에 천천히)

ezssam 게임을 인터넷에 올리는 방법. 준비는 다 끝나 있고, 아래 **두 단계만** 하면 됨.
(둘 다 지현 로그인이 필요한 부분이라 직접 해야 함)

---

## 1단계: GitHub에 올리기 (push)

`~/Desktop/bahkkum-k` 폴더에 새 게임이 `ezssam-games/` 폴더로 들어가 **커밋까지 완료**돼 있음.
기존 게임들(dodge, mathpoly 등)은 안 건드림. 올라갈 건 `ezssam-games/` 폴더뿐.

VS Code 터미널에서:

```bash
cd ~/Desktop/bahkkum-k && git push origin main
```

- 로그인 물어보면: 아이디 `dndsu2810`, 비밀번호 자리에는 **Personal Access Token**
  (GitHub 비밀번호 아님). 토큰: github.com → Settings → Developer settings →
  Personal access tokens → Generate. 권한은 `repo` 체크.
- 성공하면 `main -> main` 비슷한 줄이 나옴.

## 2단계: Cloudflare Pages 연결 (자동 배포)

dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
→ 저장소 `dndsu2810/bahkkum-k` 선택 → 빌드 설정:

| 항목 | 값 |
|---|---|
| Production branch | `main` |
| Framework preset | `Next.js` |
| Root directory (Advanced) | `ezssam-games` |
| Build command | `npx @cloudflare/next-on-pages@1` |
| Build output directory | `.vercel/output/static` |
| 환경변수 NODE_VERSION | `20` |

→ **Save and Deploy** → 끝나면 Settings → Functions → **Compatibility flags**에
`nodejs_compat`를 Production·Preview 둘 다 추가 → **Retry deployment**.

완료되면 `○○.pages.dev` 주소 생성. 학원 PC·TV 크롬에서 열면 카메라 게임 작동.

---

## 코드 수정 후 다시 올릴 때

개발/미리보기는 `~/Desktop/ezssam-games` 에서 (`npm run dev`).
수정이 끝나면 그 내용을 `~/Desktop/bahkkum-k/ezssam-games/` 로 복사 후 커밋·push:

```bash
rsync -a --exclude '.git' --exclude 'node_modules' --exclude '.next' --exclude 'out' \
  --exclude '.vercel' --exclude '.wrangler' --exclude 'files' --exclude '.DS_Store' \
  --include '/README.md' --include '/DEPLOY.md' --exclude '/*.md' \
  ~/Desktop/ezssam-games/ ~/Desktop/bahkkum-k/ezssam-games/
cd ~/Desktop/bahkkum-k && git add ezssam-games && git commit -m "ezssam 게임 업데이트" && git push origin main
```

(루트의 README.md / DEPLOY.md 만 포함하고, 그 외 루트의 .md 계획서들은 공개 저장소에 들어가지 않도록 차단)

push하면 Cloudflare가 자동으로 다시 배포함.
