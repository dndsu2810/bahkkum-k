import { useEffect, useRef, useState } from "react";
import { uploadImage } from "../lib/configApi";

/** 노션식 리치 텍스트 에디터 — 제목 크기·굵게·형광펜·인용·콜아웃·목록·이미지.
 *  contentEditable + execCommand 기반(가벼움). value=HTML, onChange로 HTML 전달. */
export function RichEditor({ value, onChange, placeholder }: { value: string; onChange: (html: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const lastSet = useRef<string>("");

  // 외부 value가 바뀌면(편집 진입·초기화) DOM에 반영 — 입력 중 커서 튐 방지로 동일값이면 건너뜀.
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

  function cmd(command: string, arg?: string) {
    ref.current?.focus();
    try { document.execCommand(command, false, arg); } catch { /* ignore */ }
    emit();
  }
  function block(tag: string) {
    cmd("formatBlock", tag); // <h2>,<h3>,<p>,<blockquote>
  }
  function highlight() {
    ref.current?.focus();
    try {
      // 형광펜 — 노란 배경. 이미 칠해졌으면 해제 시도.
      if (!document.execCommand("hiliteColor", false, "#FFE58A")) document.execCommand("backColor", false, "#FFE58A");
    } catch { /* ignore */ }
    emit();
  }
  function callout() {
    ref.current?.focus();
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString() : "메모를 입력하세요";
    const html = `<div class="rt-callout">💡 ${escapeHtml(text)}</div><p><br></p>`;
    try { document.execCommand("insertHTML", false, html); } catch { /* ignore */ }
    emit();
  }
  async function onPickImage(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    try {
      const url = await uploadImage(f);
      ref.current?.focus();
      document.execCommand("insertHTML", false, `<img src="${url}" alt="" /><p><br></p>`);
      emit();
    } catch {
      alert("이미지 업로드에 실패했어요.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

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
        <button type="button" className="rt-b" title="인용" onClick={() => block("<blockquote>")}>❝ 인용</button>
        <button type="button" className="rt-b" title="콜아웃" onClick={callout}>💡 콜아웃</button>
        <span className="rt-div" />
        <button type="button" className="rt-b" title="이미지" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? "올리는 중…" : "🖼 이미지"}</button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onPickImage(e.target.files?.[0])} />
      </div>
      <div className="rt-area-wrap">
        {empty && <div className="rt-ph">{placeholder || "회의 전 안건·논의할 내용을 미리 적어두세요."}</div>}
        <div
          ref={ref}
          className="rt-area"
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
        />
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
