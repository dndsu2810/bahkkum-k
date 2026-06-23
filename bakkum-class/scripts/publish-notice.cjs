// 회의록 안내 공지 게시 — 캡쳐 2장 업로드 후 /api/posts 생성. (cap-meetings.cjs 세션 쿠키 사용)
const fs = require("fs");
const BASE = "https://bakkum-class.dndsu2810.workers.dev";
const cookies = JSON.parse(fs.readFileSync("scripts/cookies.json", "utf8"));
const COOKIE = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

async function upload(path) {
  const buf = fs.readFileSync(path);
  const r = await fetch(BASE + "/api/upload", { method: "POST", headers: { "content-type": "image/png", Cookie: COOKIE }, body: buf });
  const j = await r.json();
  if (!j.url) throw new Error("upload fail " + path + " " + JSON.stringify(j));
  return BASE + j.url; // /api/media/... → 절대경로(본문 img src)
}

(async () => {
  const imgList = await upload("docs/issue-shots/meet-1-screen.png");
  const imgEditor = await upload("docs/issue-shots/meet-2-editor.png");
  console.log("IMG1=" + imgList);
  console.log("IMG2=" + imgEditor);

  const title = "📋 회의록 기능이 새로 생겼어요 (AI 자동 요약)";
  const body =
    `<p>회의 내용을 녹음하거나 텍스트로 붙여넣으면 <strong>AI가 자동으로 핵심·결정사항·할 일</strong>로 요약해 정리해 주는 기능이에요. 사이드바 <strong>공통 → 회의록</strong>에서 쓸 수 있어요.</p>` +
    `<img src="${imgList}" alt="회의록 화면" />` +
    `<h3>사용 방법</h3>` +
    `<ol>` +
    `<li><strong>회의록 → 새 회의록</strong>을 눌러요.</li>` +
    `<li><strong>회의 종류·제목·날짜·참석자</strong>를 고르고, 필요하면 <strong>회의안(안건)</strong>을 미리 적어둬요.</li>` +
    `<li>회의 중 <strong>녹음</strong>하거나, 끝난 뒤 <strong>음성 파일 업로드</strong> 또는 <strong>텍스트 직접 입력</strong>을 해요.</li>` +
    `<li><strong>AI 요약 시작</strong>을 누르면 핵심 내용·결정사항·할 일이 자동으로 정리돼요.</li>` +
    `<li><strong>저장</strong>하면 목록에 남고, 나중에 다시 보거나 수정할 수 있어요.</li>` +
    `</ol>` +
    `<img src="${imgEditor}" alt="새 회의록 작성 화면" />` +
    `<h3>참고</h3>` +
    `<ul>` +
    `<li>회의 종류는 기본 항목 + <strong>직접 추가</strong>할 수 있어요.</li>` +
    `<li>참석자는 등록된 강사 중에서 골라요.</li>` +
    `<li><strong>열람 권한</strong> — 원장은 전체, 그 외 선생님은 본인이 작성했거나 참석자로 포함된 회의록만 볼 수 있어요.</li>` +
    `<li>녹음 없이 <strong>텍스트만 붙여넣어</strong> 요약해도 돼요.</li>` +
    `</ul>`;

  const r = await fetch(BASE + "/api/posts", {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: COOKIE },
    body: JSON.stringify({ title, body, audience: "staff", banner: false }),
  });
  const j = await r.json();
  console.log("POST_RESULT=" + JSON.stringify(j));
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
