// 회의안 리치 텍스트 — 저장된 HTML을 안전하게 정리(렌더용)하고, 평문으로 변환(AI 요약 입력용).

const ALLOWED = new Set([
  "P", "BR", "DIV", "SPAN", "B", "STRONG", "I", "EM", "U", "S",
  "H1", "H2", "H3", "H4", "UL", "OL", "LI", "BLOCKQUOTE", "MARK", "IMG", "A", "HR",
]);

/** 저장된 HTML에서 위험 요소(script·이벤트핸들러·javascript: 등) 제거. 스태프 전용이지만 안전하게. */
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return "";
  }
  doc.querySelectorAll("script,style,iframe,object,embed,link,meta,form,input,button").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    if (!ALLOWED.has(el.tagName)) {
      // 허용 안 되는 태그는 내용만 남기고 껍데기 제거.
      const parent = el.parentNode;
      if (parent) { while (el.firstChild) parent.insertBefore(el.firstChild, el); parent.removeChild(el); }
      return;
    }
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      const v = attr.value;
      if (n.startsWith("on")) { el.removeAttribute(attr.name); continue; }
      // 허용 속성만 — 나머지 제거(style은 색/형광펜 위해 일부 허용).
      if (n === "href") { if (/^\s*javascript:/i.test(v)) el.removeAttribute(attr.name); continue; }
      if (n === "src") { if (!/^(https?:|\/|data:image\/)/i.test(v)) el.removeAttribute(attr.name); continue; }
      if (n === "class" && el.classList.contains("rt-callout")) continue; // 콜아웃 박스 유지
      if (n === "style") {
        // background(형광펜)·color·font-size·text-align만 통과.
        const safe = v
          .split(";")
          .map((s) => s.trim())
          .filter((s) => /^(background(-color)?|color|font-size|text-align)\s*:/i.test(s))
          .join("; ");
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
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return "";
  }
  doc.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
  doc.querySelectorAll("li").forEach((li) => { li.prepend("- "); });
  const blockSel = "p,div,h1,h2,h3,h4,li,blockquote";
  doc.querySelectorAll(blockSel).forEach((el) => { el.append("\n"); });
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

/** 회의안에 실제 내용이 있는지(빈 태그만 있으면 false). */
export function hasContent(html: string): boolean {
  return htmlToText(html).length > 0 || /<img/i.test(html || "");
}
