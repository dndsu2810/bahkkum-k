// 리치 텍스트 — 저장된 HTML을 안전하게 정리(렌더용)하고, 평문으로 변환(AI 요약 입력용).
// 노션식 블록: 제목·굵게·형광펜·인용·콜아웃·목록·체크리스트·표·북마크·임베드·구분선·이미지.

const ALLOWED = new Set([
  "P", "BR", "DIV", "SPAN", "B", "STRONG", "I", "EM", "U", "S",
  "H1", "H2", "H3", "H4", "UL", "OL", "LI", "BLOCKQUOTE", "MARK", "IMG", "A", "HR",
  "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "IFRAME",
]);

// 임베드 허용 도메인(신뢰 도메인만 iframe 허용 — XSS·클릭재킹 방지).
const EMBED_HOSTS = ["youtube.com", "youtube-nocookie.com", "youtu.be", "vimeo.com", "player.vimeo.com", "drive.google.com", "docs.google.com", "figma.com"];
function bareHost(h: string): string { return h.replace(/^www\./, ""); }
export function embedHostOk(src: string): boolean {
  try { return EMBED_HOSTS.includes(bareHost(new URL(src).hostname)); } catch { return false; }
}
/** 사용자가 붙인 URL → 임베드용 src로 변환. 지원 안 되면 null. */
export function toEmbedSrc(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = bareHost(u.hostname);
  if (host === "youtu.be") { const id = u.pathname.slice(1); return id ? `https://www.youtube.com/embed/${id}` : null; }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname.startsWith("/embed/")) return `https://www.youtube.com${u.pathname}`;
    const v = u.searchParams.get("v"); return v ? `https://www.youtube.com/embed/${v}` : null;
  }
  if (host === "vimeo.com") { const id = u.pathname.split("/").filter(Boolean)[0]; return id ? `https://player.vimeo.com/video/${id}` : null; }
  if (host === "player.vimeo.com") return u.href;
  if (host === "drive.google.com") { const m = u.pathname.match(/\/file\/d\/([^/]+)/); if (m) return `https://drive.google.com/file/d/${m[1]}/preview`; return u.href.replace(/\/(view|edit)(\?.*)?$/, "/preview"); }
  if (host === "docs.google.com") return u.href.replace(/\/(edit|view)(\?.*)?$/, "/preview");
  if (host === "figma.com") return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url)}`;
  return null;
}

/** 저장된 HTML에서 위험 요소(script·이벤트핸들러·javascript: 등) 제거. 스태프 전용이지만 안전하게. */
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  let doc: Document;
  try { doc = new DOMParser().parseFromString(html, "text/html"); } catch { return ""; }
  // iframe은 아래에서 도메인 검증 후 남기므로 여기서 일괄 제거 목록에 넣지 않는다.
  doc.querySelectorAll("script,style,object,embed,link,meta,form,input,button").forEach((n) => n.remove());
  // body 하위 요소만 순회 — doc 전체를 돌면 html/head/body까지 잡혀 '껍데기 제거'가 document에 insertBefore를 시도하다 터진다.
  doc.body.querySelectorAll("*").forEach((el) => {
    if (!ALLOWED.has(el.tagName)) {
      const parent = el.parentNode; // 허용 안 되는 태그는 내용만 남기고 껍데기 제거.
      if (parent) { while (el.firstChild) parent.insertBefore(el.firstChild, el); parent.removeChild(el); }
      return;
    }
    if (el.tagName === "IFRAME") { // 신뢰 도메인 임베드만 통과.
      const src = el.getAttribute("src") || "";
      if (!embedHostOk(src)) { el.remove(); return; }
      const keep = new Set(["src", "allow", "allowfullscreen", "loading", "class", "style"]);
      for (const attr of [...el.attributes]) if (!keep.has(attr.name.toLowerCase())) el.removeAttribute(attr.name);
      el.setAttribute("loading", "lazy");
      el.setAttribute("class", "rt-embed");
      return;
    }
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      const v = attr.value;
      if (n.startsWith("on")) { el.removeAttribute(attr.name); continue; }
      if (n === "href") { if (/^\s*javascript:/i.test(v)) el.removeAttribute(attr.name); continue; }
      if (n === "src") { if (!/^(https?:|\/|data:image\/)/i.test(v)) el.removeAttribute(attr.name); continue; }
      if (n === "target") { el.setAttribute("rel", "noopener noreferrer"); continue; }
      if (n === "rel") continue;
      if (n === "data-checked") continue; // 체크리스트 상태
      if (n === "class") { // rt-* 클래스만 유지(우리 블록 스타일).
        const safe = v.split(/\s+/).filter((c) => c.startsWith("rt-")).join(" ");
        if (safe) el.setAttribute("class", safe); else el.removeAttribute("class");
        continue;
      }
      if (n === "style") {
        const safe = v.split(";").map((s) => s.trim()).filter((s) => /^(background(-color)?|color|font-size|text-align|width|height)\s*:/i.test(s)).join("; ");
        if (safe) el.setAttribute("style", safe); else el.removeAttribute("style");
        continue;
      }
      el.removeAttribute(attr.name);
    }
  });
  return doc.body.innerHTML;
}

/** HTML → 평문(AI 요약 입력). 블록 사이는 줄바꿈으로. */
export function htmlToText(html: string): string {
  if (!html) return "";
  let doc: Document;
  try { doc = new DOMParser().parseFromString(html, "text/html"); } catch { return ""; }
  doc.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
  doc.querySelectorAll("li").forEach((li) => { li.prepend("- "); });
  doc.querySelectorAll("td,th").forEach((c) => { c.append("\t"); });
  const blockSel = "p,div,h1,h2,h3,h4,li,blockquote,tr";
  doc.querySelectorAll(blockSel).forEach((el) => { el.append("\n"); });
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

/** 본문에 실제 내용이 있는지(빈 태그만 있으면 false). */
export function hasContent(html: string): boolean {
  return htmlToText(html).length > 0 || /<img|<iframe|rt-bookmark/i.test(html || "");
}
