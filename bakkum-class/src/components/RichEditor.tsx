import { useEffect, useRef, useState } from "react";
import { uploadImage, linkMeta, type LinkMeta } from "../lib/configApi";
import { toEmbedSrc } from "../lib/richText";

/** 노션식 리치 텍스트 에디터 — 제목·굵게·형광펜·인용·콜아웃·목록·체크리스트·표·북마크·임베드·이미지.
 *  "/"를 치면 블록 삽입 메뉴가 떠요. contentEditable + execCommand 기반. value=HTML. */
const EMOJIS = ["😀", "😅", "😊", "🙂", "😍", "🤔", "😴", "😭", "😡", "👍", "👏", "🙏", "🔥", "✨", "🎉", "✅", "❌", "⭐", "❤️", "💡", "📌", "📝", "📣", "⚠️", "📅", "⏰", "💰", "📈", "🏫", "🐝"];

export function RichEditor({ value, onChange, placeholder }: { value: string; onChange: (html: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [slash, setSlash] = useState<{ x: number; y: number; filter: string } | null>(null);
  const [slashIdx, setSlashIdx] = useState(0);
  const slashRangeRef = useRef<{ node: Node; slashOffset: number; caretOffset: number } | null>(null);
  const filteredRef = useRef<typeof BLOCKS>([]);
  const lastSet = useRef<string>("");

  useEffect(() => {
    const el = ref.current;
    if (el && value !== lastSet.current && value !== el.innerHTML) {
      el.innerHTML = value || "";
      lastSet.current = value || "";
    }
  }, [value]);

  function emit() {
    const el = ref.current;
    if (!el) return;
    lastSet.current = el.innerHTML;
    onChange(el.innerHTML);
  }
  function insertHTML(html: string) {
    ref.current?.focus();
    try { document.execCommand("insertHTML", false, html); } catch { /* ignore */ }
    emit();
  }
  function cmd(command: string, arg?: string) { ref.current?.focus(); try { document.execCommand(command, false, arg); } catch { /* ignore */ } emit(); }
  function block(tag: string) { cmd("formatBlock", tag); }
  function highlight() {
    ref.current?.focus();
    try { if (!document.execCommand("hiliteColor", false, "#FFE58A")) document.execCommand("backColor", false, "#FFE58A"); } catch { /* ignore */ }
    emit();
  }
  function callout() {
    ref.current?.focus();
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString() : "메모를 입력하세요";
    insertHTML(`<div class="rt-callout">💡 ${escapeHtml(text)}</div><p><br></p>`);
  }
  function insertTodo() { insertHTML(`<ul class="rt-todo"><li data-checked="false">할 일</li></ul>`); }
  function insertTable() {
    const cell = "<td><br></td>";
    const row = `<tr>${cell}${cell}${cell}</tr>`;
    insertHTML(`<table class="rt-table"><tbody>${row}${row}</tbody></table><p><br></p>`);
  }

  // 표: 커서가 든 셀 기준으로 행·열 추가.
  function currentCell(): HTMLTableCellElement | null {
    const sel = window.getSelection();
    let n: Node | null = sel?.anchorNode || null;
    while (n && n !== ref.current) { if (n.nodeName === "TD" || n.nodeName === "TH") return n as HTMLTableCellElement; n = n.parentNode; }
    return null;
  }
  function addRow() {
    const c = currentCell(); if (!c) { setBusy("표 안에 커서를 두고 눌러요"); setTimeout(() => setBusy(""), 1500); return; }
    const tr = c.parentElement as HTMLTableRowElement;
    const ntr = document.createElement("tr");
    for (let i = 0; i < tr.children.length; i++) { const td = document.createElement("td"); td.innerHTML = "<br>"; ntr.appendChild(td); }
    tr.after(ntr); emit();
  }
  function addCol() {
    const c = currentCell(); if (!c) { setBusy("표 안에 커서를 두고 눌러요"); setTimeout(() => setBusy(""), 1500); return; }
    const idx = Array.from(c.parentElement!.children).indexOf(c);
    c.closest("table")?.querySelectorAll("tr").forEach((tr) => { const td = document.createElement("td"); td.innerHTML = "<br>"; const at = tr.children[idx]; if (at) at.after(td); else tr.appendChild(td); });
    emit();
  }

  function saveSel(): Range | null { const s = window.getSelection(); return s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null; }
  function restoreSel(r: Range | null) { ref.current?.focus(); if (r) { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); } }

  function bookmarkHtml(m: LinkMeta): string {
    const img = m.image ? `<img class="rt-bm-img" src="${escapeAttr(m.image)}" alt="" />` : "";
    return `<a class="rt-bookmark" href="${escapeAttr(m.url)}" target="_blank" rel="noopener noreferrer" contenteditable="false"><span class="rt-bm-body"><span class="rt-bm-title">${escapeHtml(m.title)}</span>${m.desc ? `<span class="rt-bm-desc">${escapeHtml(m.desc)}</span>` : ""}<span class="rt-bm-url">${escapeHtml(m.site || m.url)}</span></span>${img}</a><p><br></p>`;
  }
  async function bookmark() {
    const saved = saveSel();
    const url = window.prompt("북마크할 링크 주소를 붙여넣어 주세요"); if (!url) return;
    setBusy("불러오는 중…");
    let m: LinkMeta;
    try { m = await linkMeta(url); } catch { m = { url, title: url, desc: "", image: "", site: "" }; }
    setBusy("");
    restoreSel(saved);
    insertHTML(bookmarkHtml(m));
  }
  function embed() {
    const saved = saveSel();
    const url = window.prompt("임베드할 링크 (유튜브·비메오·구글드라이브·피그마)"); if (!url) return;
    const src = toEmbedSrc(url);
    restoreSel(saved);
    if (!src) { setBusy("지원하지 않는 링크예요"); setTimeout(() => setBusy(""), 1800); return; }
    insertHTML(`<div class="rt-embed-wrap" contenteditable="false"><iframe class="rt-embed" src="${escapeAttr(src)}" loading="lazy" allowfullscreen></iframe></div><p><br></p>`);
  }
  async function onPickImage(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    try { const url = await uploadImage(f); insertHTML(`<img src="${escapeAttr(url)}" alt="" /><p><br></p>`); }
    catch { alert("이미지 업로드에 실패했어요."); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  function insertEmoji(e: string) { setEmojiOpen(false); cmd("insertText", e); }

  // 체크리스트 체크박스 클릭 토글.
  function onAreaClick(e: React.MouseEvent) {
    const t = e.target as HTMLElement;
    const li = t.closest?.("ul.rt-todo > li") as HTMLElement | null;
    if (li && (e.nativeEvent as MouseEvent).offsetX < 26) {
      li.setAttribute("data-checked", li.getAttribute("data-checked") === "true" ? "false" : "true");
      emit();
    }
  }

  // 블록 메뉴(툴바·슬래시 공용).
  const BLOCKS = [
    { key: "h2", label: "큰 제목", hint: "H1", kw: "제목 title h1", run: () => block("<h2>") },
    { key: "h3", label: "소제목", hint: "H2", kw: "제목 title h2", run: () => block("<h3>") },
    { key: "text", label: "본문", hint: "T", kw: "본문 text", run: () => block("<p>") },
    { key: "ul", label: "글머리 목록", hint: "•", kw: "목록 list bullet", run: () => cmd("insertUnorderedList") },
    { key: "ol", label: "번호 목록", hint: "1.", kw: "번호 ordered number", run: () => cmd("insertOrderedList") },
    { key: "todo", label: "체크리스트", hint: "☑", kw: "체크 todo 할일 check", run: insertTodo },
    { key: "quote", label: "인용", hint: "❝", kw: "인용 quote", run: () => block("<blockquote>") },
    { key: "callout", label: "콜아웃", hint: "💡", kw: "콜아웃 callout 강조", run: callout },
    { key: "table", label: "표", hint: "▦", kw: "표 table", run: insertTable },
    { key: "divider", label: "구분선", hint: "―", kw: "구분선 divider 선 hr", run: () => insertHTML("<hr><p><br></p>") },
    { key: "image", label: "이미지", hint: "🖼", kw: "이미지 image 사진", run: () => fileRef.current?.click() },
    { key: "bookmark", label: "북마크", hint: "🔖", kw: "북마크 bookmark 링크 link", run: bookmark },
    { key: "embed", label: "임베드", hint: "▶", kw: "임베드 embed 영상 유튜브 video", run: embed },
  ];

  // 슬래시("/") 메뉴 — 텍스트 노드에서 토큰 시작 "/" 뒤 글자를 필터로.
  function updateSlash() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) { setSlash(null); return; }
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3) { setSlash(null); return; }
    const text = node.textContent || "";
    const caret = sel.anchorOffset;
    let i = caret - 1;
    while (i >= 0 && !/\s/.test(text[i]) && text[i] !== "/") i--;
    if (i < 0 || text[i] !== "/" || (i > 0 && !/\s/.test(text[i - 1]))) { setSlash(null); return; }
    const filter = text.slice(i + 1, caret);
    if (/\s/.test(filter)) { setSlash(null); return; }
    slashRangeRef.current = { node, slashOffset: i, caretOffset: caret };
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!wrap) return;
    setSlash({ x: rect.left - wrap.left, y: rect.bottom - wrap.top + 4, filter });
    setSlashIdx(0);
  }
  function chooseSlash(b: (typeof BLOCKS)[number]) {
    const ctx = slashRangeRef.current;
    if (ctx) {
      try {
        const r = document.createRange();
        r.setStart(ctx.node, ctx.slashOffset);
        r.setEnd(ctx.node, ctx.caretOffset);
        const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); r.deleteContents();
      } catch { /* ignore */ }
    }
    setSlash(null);
    b.run();
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (!slash) return;
    const list = filteredRef.current;
    if (e.key === "ArrowDown") { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, list.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { if (list[slashIdx]) { e.preventDefault(); chooseSlash(list[slashIdx]); } }
    else if (e.key === "Escape") { setSlash(null); }
  }

  const filtered = slash ? BLOCKS.filter((b) => !slash.filter || (b.label + " " + b.kw).toLowerCase().includes(slash.filter.toLowerCase())) : [];
  filteredRef.current = filtered;
  const empty = !value || value === "<br>" || value === "<p><br></p>";

  return (
    <div className="rt">
      <div className="rt-bar">
        <button type="button" className="rt-b" title="큰 제목" onClick={() => block("<h2>")}>H1</button>
        <button type="button" className="rt-b" title="소제목" onClick={() => block("<h3>")}>H2</button>
        <button type="button" className="rt-b" title="본문" onClick={() => block("<p>")}>본문</button>
        <span className="rt-div" />
        <button type="button" className="rt-b bold" title="굵게" onClick={() => cmd("bold")}>B</button>
        <button type="button" className="rt-b" title="형광펜" onClick={highlight}><span className="rt-hl">A</span></button>
        <span className="rt-div" />
        <button type="button" className="rt-b" title="글머리 목록" onClick={() => cmd("insertUnorderedList")}>• 목록</button>
        <button type="button" className="rt-b" title="체크리스트" onClick={insertTodo}>☑ 체크</button>
        <button type="button" className="rt-b" title="인용" onClick={() => block("<blockquote>")}>❝ 인용</button>
        <button type="button" className="rt-b" title="콜아웃" onClick={callout}>💡 콜아웃</button>
        <span className="rt-div" />
        <button type="button" className="rt-b" title="표 삽입" onClick={insertTable}>▦ 표</button>
        <button type="button" className="rt-b" title="표에 행 추가" onClick={addRow}>+행</button>
        <button type="button" className="rt-b" title="표에 열 추가" onClick={addCol}>+열</button>
        <button type="button" className="rt-b" title="구분선" onClick={() => insertHTML("<hr><p><br></p>")}>― 구분선</button>
        <span className="rt-div" />
        <button type="button" className="rt-b" title="북마크(링크 카드)" onClick={bookmark}>🔖 북마크</button>
        <button type="button" className="rt-b" title="임베드(영상·문서)" onClick={embed}>▶ 임베드</button>
        <button type="button" className="rt-b" title="이모지" onClick={() => setEmojiOpen((o) => !o)}>😊 이모지</button>
        <button type="button" className="rt-b" title="이미지" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? "올리는 중…" : "🖼 이미지"}</button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onPickImage(e.target.files?.[0])} />
        {busy && <span className="rt-busy">{busy}</span>}
      </div>
      {emojiOpen && (
        <div className="rt-emoji">
          {EMOJIS.map((e) => <button key={e} type="button" onClick={() => insertEmoji(e)}>{e}</button>)}
        </div>
      )}
      <div className="rt-area-wrap" ref={wrapRef}>
        {empty && <div className="rt-ph">{placeholder || "내용을 적어주세요.  /  를 누르면 블록을 넣을 수 있어요."}</div>}
        <div
          ref={ref}
          className="rt-area"
          contentEditable
          suppressContentEditableWarning
          onInput={() => { emit(); updateSlash(); }}
          onKeyUp={updateSlash}
          onKeyDown={onKeyDown}
          onMouseUp={() => slash && setSlash(null)}
          onClick={onAreaClick}
          onBlur={emit}
        />
        {slash && filtered.length > 0 && (
          <div className="rt-slash" style={{ left: slash.x, top: slash.y }}>
            {filtered.map((b, i) => (
              <button key={b.key} type="button" className={"rt-slash-it" + (i === slashIdx ? " on" : "")}
                onMouseDown={(e) => { e.preventDefault(); chooseSlash(b); }} onMouseEnter={() => setSlashIdx(i)}>
                <span className="rt-slash-ic">{b.hint}</span>{b.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttr(s: string): string { return escapeHtml(s).replace(/"/g, "&quot;"); }
