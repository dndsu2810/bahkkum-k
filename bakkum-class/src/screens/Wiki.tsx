import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import { wikiApi, type WikiPage, type WikiStatus } from "../lib/hubApi";
import { fmtWhen } from "../lib/dates";
import { ImageGrid } from "../components/ImageGrid";
import { copyText } from "../lib/report";
import { Icon } from "../icons";

/** 표 셀 — 누르면 그 값이 복사된다(아이디·비번 복붙용). 빈 칸은 '—'. */
function CopyCell({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const v = text.trim();
  if (!v || v === "-") return <td className="wiki-td"><span className="acct-empty">—</span></td>;
  return (
    <td className="wiki-td">
      <button
        className={"wiki-cell" + (done ? " done" : "")}
        title="복사"
        onClick={async () => {
          await copyText(v);
          setDone(true);
          window.setTimeout(() => setDone(false), 1100);
        }}
      >
        <span className="wiki-cell-val">{v}</span>
        <span className="wiki-cell-tag">{done ? "복사됨" : "복사"}</span>
      </button>
    </td>
  );
}

/** 표를 렌더링(헤더 + 행, 각 셀 복사). */
function DataTable({ head, rows, k }: { head: string[]; rows: string[][]; k: number }) {
  return (
    <div className="wiki-tbl-wrap" key={k}>
      <table className="wiki-tbl">
        <thead>
          <tr>{head.map((h, j) => <th key={j}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {head.map((_, ci) => <CopyCell key={ci} text={r[ci] ?? ""} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Field = { label: string; value: string };
const fieldOf = (s: string): Field | null => {
  const m = s.match(/^\s*([^:|]{1,20})\s*:\s*(.*)$/);
  return m ? { label: m[1].trim(), value: m[2].trim() } : null;
};

/** 매뉴얼 본문(평문)을 렌더링.
 *  - `a | b | c` 줄(노션 표/하위DB) → 표 + 셀 복사
 *  - 빈 줄로 구분된 `라벨: 값` 묶음들(예 site/ID/PW/비고) → 표 + 셀 복사
 *  - 【제목】 → 소제목, 그 외 → 문단. */
function WikiBody({ text }: { text: string }) {
  if (!text.trim()) return <div className="wiki-body">(본문 없음)</div>;
  const isHead = (s: string) => /^【.*】$/.test(s.trim());

  // 1) 빈 줄 경계로 청크 나누기.
  const chunks: string[][] = [];
  let cur: string[] = [];
  for (const ln of text.split("\n")) {
    if (ln.trim() === "") {
      if (cur.length) chunks.push(cur), (cur = []);
    } else cur.push(ln);
  }
  if (cur.length) chunks.push(cur);

  // 2) 청크 분류.
  type Cls =
    | { t: "pipe"; lines: string[] }
    | { t: "record"; fields: Field[] }
    | { t: "head"; text: string }
    | { t: "text"; text: string };
  const classify = (lines: string[]): Cls => {
    if (lines.some((l) => l.includes("|")) && lines.length > 1) return { t: "pipe", lines };
    if (lines.length === 1 && isHead(lines[0])) return { t: "head", text: lines[0].trim().replace(/^【|】$/g, "").trim() };
    const fields = lines.map(fieldOf);
    if (lines.length >= 2 && fields.every(Boolean)) return { t: "record", fields: fields as Field[] };
    return { t: "text", text: lines.join("\n").trim() };
  };
  const cls = chunks.map(classify);

  // 3) 렌더 — 연속된 record 청크는 하나의 표로 합친다.
  const blocks: ReactNode[] = [];
  let key = 0;
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    if (c.t === "record") {
      const recs: Field[][] = [];
      while (i < cls.length && cls[i].t === "record") {
        recs.push((cls[i] as { t: "record"; fields: Field[] }).fields);
        i++;
      }
      i--;
      const cols: string[] = [];
      for (const r of recs) for (const f of r) if (!cols.includes(f.label)) cols.push(f.label);
      const rows = recs.map((r) => cols.map((col) => r.find((f) => f.label === col)?.value ?? ""));
      blocks.push(<DataTable head={cols} rows={rows} k={key++} />);
    } else if (c.t === "pipe") {
      // 파이프 표 청크에 섞인 비-파이프 줄(【제목】·설명)은 표 헤더로 먹지 말고 따로 렌더.
      // (빈 줄 없이 제목이 표 위에 붙으면 그 줄이 1칸 헤더가 돼 값이 사라지던 문제 방지.)
      let tbl: string[] = [];
      const flush = () => {
        if (!tbl.length) return;
        const run = tbl.map((l) => l.split("|").map((x) => x.trim()));
        const [head, ...body] = run;
        blocks.push(<DataTable head={head} rows={body} k={key++} />);
        tbl = [];
      };
      for (const ln of c.lines) {
        if (ln.includes("|")) { tbl.push(ln); continue; }
        flush();
        if (isHead(ln)) blocks.push(<h4 className="wiki-sub" key={key++}>{ln.trim().replace(/^【|】$/g, "").trim()}</h4>);
        else if (ln.trim()) blocks.push(<p className="wiki-p" key={key++}>{ln.trim()}</p>);
      }
      flush();
    } else if (c.t === "head") {
      blocks.push(<h4 className="wiki-sub" key={key++}>{c.text}</h4>);
    } else if (c.text) {
      blocks.push(<p className="wiki-p" key={key++}>{c.text}</p>);
    }
  }
  return <div className="wiki-body">{blocks}</div>;
}

/* ===== 본문 블록 편집기 — 글/표 블록으로 입력·수정(저장은 파이프 표 텍스트로 동일) ===== */
type Block = { type: "text"; text: string } | { type: "table"; rows: string[][] };

/** 본문 텍스트 → 블록 배열. 연속된 `a | b` 줄은 표, 나머지는 글. */
function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let textBuf: string[] = [];
  let tblBuf: string[] = [];
  const flushText = () => { const t = textBuf.join("\n").trim(); if (t) blocks.push({ type: "text", text: t }); textBuf = []; };
  const flushTbl = () => {
    if (!tblBuf.length) return;
    const rows = tblBuf.map((l) => l.split("|").map((c) => c.trim()));
    const cols = Math.max(...rows.map((r) => r.length), 1);
    blocks.push({ type: "table", rows: rows.map((r) => { const rr = r.slice(); while (rr.length < cols) rr.push(""); return rr; }) });
    tblBuf = [];
  };
  for (const ln of body.replace(/\r/g, "").split("\n")) {
    if (ln.includes("|")) { flushText(); tblBuf.push(ln); }
    else { flushTbl(); textBuf.push(ln); }
  }
  flushTbl();
  flushText();
  return blocks;
}

/** 블록 배열 → 본문 텍스트(WikiBody가 그대로 표/글로 렌더). */
function serializeBlocks(blocks: Block[]): string {
  return blocks
    .map((b) => (b.type === "text" ? b.text.trim() : b.rows.map((r) => r.map((c) => c.trim()).join(" | ")).join("\n")))
    .filter((s) => s.trim())
    .join("\n\n");
}

/** 위키 본문 편집기 — '쉬운 편집'(블록·표 셀) ↔ '직접 입력'(텍스트) 전환. */
function BodyEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [mode, setMode] = useState<"block" | "text">("block");
  const [blocks, setBlocks] = useState<Block[]>(() => parseBlocks(value));

  const update = (bs: Block[]) => { setBlocks(bs); onChange(serializeBlocks(bs)); };
  const patch = (bi: number, b: Block) => update(blocks.map((x, i) => (i === bi ? b : x)));
  const delBlock = (bi: number) => update(blocks.filter((_, i) => i !== bi));
  const moveBlock = (bi: number, d: number) => {
    const j = bi + d;
    if (j < 0 || j >= blocks.length) return;
    const bs = blocks.slice();
    [bs[bi], bs[j]] = [bs[j], bs[bi]];
    update(bs);
  };
  const addText = () => update([...blocks, { type: "text", text: "" }]);
  const addTable = () => update([...blocks, { type: "table", rows: [["항목", "값"], ["", ""]] }]);

  // 표 셀/행/열 조작.
  const setCell = (bi: number, ri: number, ci: number, v: string) => {
    const b = blocks[bi];
    if (b.type !== "table") return;
    patch(bi, { type: "table", rows: b.rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)) });
  };
  const addRow = (bi: number) => { const b = blocks[bi]; if (b.type !== "table") return; patch(bi, { type: "table", rows: [...b.rows, b.rows[0].map(() => "")] }); };
  const delRow = (bi: number, ri: number) => { const b = blocks[bi]; if (b.type !== "table" || b.rows.length <= 1) return; patch(bi, { type: "table", rows: b.rows.filter((_, i) => i !== ri) }); };
  const addCol = (bi: number) => { const b = blocks[bi]; if (b.type !== "table") return; patch(bi, { type: "table", rows: b.rows.map((r) => [...r, ""]) }); };
  const delCol = (bi: number, ci: number) => { const b = blocks[bi]; if (b.type !== "table" || b.rows[0].length <= 1) return; patch(bi, { type: "table", rows: b.rows.map((r) => r.filter((_, j) => j !== ci)) }); };

  if (mode === "text") {
    return (
      <div className="wbe">
        <div className="wbe-bar">
          <span className="wbe-hint">직접 입력 — `머리 | 값` 줄은 표가 됩니다.</span>
          <button type="button" className="btn ghost sm" onClick={() => { setBlocks(parseBlocks(value)); setMode("block"); }}>쉬운 편집으로</button>
        </div>
        <textarea className="input wiki-body-edit" rows={16} value={value} onChange={(e) => onChange(e.target.value)} placeholder="본문 (자유 입력)" />
      </div>
    );
  }

  return (
    <div className="wbe">
      <div className="wbe-bar">
        <span className="wbe-hint">글과 표를 블록으로 추가·수정하세요. 표는 칸을 눌러 바로 입력합니다.</span>
        <button type="button" className="btn ghost sm" onClick={() => setMode("text")}>직접 입력으로</button>
      </div>

      {blocks.length === 0 && <div className="wbe-empty">아래 버튼으로 글이나 표를 추가하세요.</div>}

      {blocks.map((b, bi) => (
        <div className="wbe-block" key={bi}>
          <div className="wbe-block-side">
            <button type="button" className="wbe-ic" title="위로" onClick={() => moveBlock(bi, -1)} disabled={bi === 0}><Icon name="chev" /></button>
            <button type="button" className="wbe-ic down" title="아래로" onClick={() => moveBlock(bi, 1)} disabled={bi === blocks.length - 1}><Icon name="chev" /></button>
            <button type="button" className="wbe-ic del" title="블록 삭제" onClick={() => delBlock(bi)}><Icon name="trash" /></button>
          </div>
          <div className="wbe-block-body">
            {b.type === "text" ? (
              <textarea className="input wbe-text" rows={Math.min(10, Math.max(2, b.text.split("\n").length))} value={b.text} placeholder="내용을 입력하세요. 【제목】 줄은 소제목이 됩니다." onChange={(e) => patch(bi, { type: "text", text: e.target.value })} />
            ) : (
              <div className="wbe-table-wrap">
                <table className="wbe-table">
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri} className={ri === 0 ? "head" : ""}>
                        {r.map((c, ci) => (
                          <td key={ci}>
                            {ri === 0 && <button type="button" className="wbe-colx" title="열 삭제" onClick={() => delCol(bi, ci)}>×</button>}
                            <input className="wbe-cell" value={c} placeholder={ri === 0 ? "머리글" : ""} onChange={(e) => setCell(bi, ri, ci, e.target.value)} />
                          </td>
                        ))}
                        <td className="wbe-rowact">
                          <button type="button" className="wbe-ic del" title="행 삭제" onClick={() => delRow(bi, ri)} disabled={b.rows.length <= 1}><Icon name="trash" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="wbe-table-act">
                  <button type="button" className="btn ghost sm" onClick={() => addRow(bi)}><Icon name="plus" /> 행</button>
                  <button type="button" className="btn ghost sm" onClick={() => addCol(bi)}><Icon name="plus" /> 열</button>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}

      <div className="wbe-add">
        <button type="button" className="btn ghost" onClick={addText}><Icon name="plus" /> 글 추가</button>
        <button type="button" className="btn ghost" onClick={addTable}><Icon name="plus" /> 표 추가</button>
      </div>
    </div>
  );
}

const IMPORTANCE = [
  { v: 1, label: "낮음" },
  { v: 2, label: "보통" },
  { v: 3, label: "높음" },
  { v: 4, label: "핵심" },
];
const STATUS: { v: WikiStatus; label: string }[] = [
  { v: "draft", label: "초안" },
  { v: "writing", label: "작성중" },
  { v: "review", label: "검토중" },
  { v: "current", label: "최신" },
  { v: "outdated", label: "업데이트 필요" },
];
const impLabel = (v: number) => IMPORTANCE.find((x) => x.v === v)?.label || "보통";
const stLabel = (v: string) => STATUS.find((x) => x.v === v)?.label || v;

type Editing = { id?: string; title: string; body: string; importance: number; status: WikiStatus; images: string[] } | null;

/** 바꿈 매뉴얼 위키 — 목록(중요도·상태·최종수정) + 본문 보기/편집. 학생 제외 전원 열람. */
export function Wiki() {
  const { user } = useAuth();
  const canEdit = user?.role !== "student"; // 스태프 모두 편집(협업 위키)
  const isAdmin = user?.role === "admin";
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [sel, setSel] = useState<string>("");
  const [edit, setEdit] = useState<Editing>(null);
  const [sortBy, setSortBy] = useState<"updated" | "importance">("updated");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const mainRef = useRef<HTMLDivElement>(null);

  // 목록에서 글을 고르면 본문 영역을 화면 위로 끌어와, 스크롤을 직접 올릴 필요 없게.
  useEffect(() => {
    if (sel) mainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [sel]);

  async function reload() {
    try {
      setPages(await wikiApi.list());
      setErr("");
    } catch {
      setErr("불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  const sorted = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const arr = pages.filter((p) => !kw || p.title.toLowerCase().includes(kw) || p.body.toLowerCase().includes(kw));
    arr.sort((a, b) => (sortBy === "importance" ? b.importance - a.importance : b.updatedAt - a.updatedAt));
    return arr;
  }, [pages, sortBy, q]);

  const current = pages.find((p) => p.id === sel) || null;

  async function save() {
    if (!edit || !edit.title.trim()) return;
    try {
      const r = await wikiApi.save({
        id: edit.id,
        title: edit.title.trim(),
        body: edit.body,
        importance: edit.importance,
        status: edit.status,
        images: edit.images,
      });
      setEdit(null);
      await reload();
      if (r.id) setSel(r.id);
    } catch {
      setErr("저장에 실패했어요.");
    }
  }
  async function remove(p: WikiPage) {
    if (!window.confirm(`"${p.title}" 글을 삭제할까요?`)) return;
    try {
      await wikiApi.remove(p.id);
      if (sel === p.id) setSel("");
      await reload();
    } catch {
      setErr("삭제 권한이 없거나 실패했어요.");
    }
  }

  return (
    <div className="wiki">
      <div className="wiki-side">
        <input
          className="input"
          style={{ marginBottom: 8 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="제목·본문 검색"
        />
        <div className="wiki-side-h">
          <select className="sm-input" value={sortBy} onChange={(e) => setSortBy(e.target.value as "updated" | "importance")}>
            <option value="updated">최근 수정순</option>
            <option value="importance">중요도순</option>
          </select>
          {canEdit && (
            <button
              className="btn primary sm"
              onClick={() => setEdit({ title: "", body: "", importance: 2, status: "draft", images: [] })}
            >
              새 글
            </button>
          )}
        </div>
        <div className="wiki-list">
          {sorted.map((p) => (
            <button key={p.id} className={"wiki-item" + (sel === p.id ? " on" : "")} onClick={() => { setSel(p.id); setEdit(null); }}>
              <div className="wiki-item-t">{p.title}</div>
              <div className="wiki-item-m">
                <span className={"wiki-imp i" + p.importance}>{impLabel(p.importance)}</span>
                <span className={"wiki-st s-" + p.status}>{stLabel(p.status)}</span>
              </div>
            </button>
          ))}
          {sorted.length === 0 && <div className="hub-muted" style={{ padding: 12 }}>아직 글이 없어요.</div>}
        </div>
      </div>

      <div className="wiki-main" ref={mainRef} style={{ scrollMarginTop: 12 }}>
        {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}
        {edit ? (
          <div className="wiki-edit">
            <input
              className="input"
              value={edit.title}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              placeholder="제목"
            />
            <div className="wiki-edit-row">
              <label>
                중요도
                <select className="sm-input" value={edit.importance} onChange={(e) => setEdit({ ...edit, importance: Number(e.target.value) })}>
                  {IMPORTANCE.map((i) => (
                    <option key={i.v} value={i.v}>{i.label}</option>
                  ))}
                </select>
              </label>
              <label>
                상태
                <select className="sm-input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as WikiStatus })}>
                  {STATUS.map((s) => (
                    <option key={s.v} value={s.v}>{s.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <BodyEditor value={edit.body} onChange={(v) => setEdit({ ...edit, body: v })} />
            <div className="wiki-edit-act">
              <button className="btn primary" onClick={save} disabled={!edit.title.trim()}>저장</button>
              <button className="btn ghost" onClick={() => setEdit(null)}>취소</button>
            </div>
          </div>
        ) : current ? (
          <div className="wiki-view">
            <div className="wiki-view-h">
              <h1 className="sm-title">{current.title}</h1>
              <div className="wiki-view-act">
                {canEdit && (
                  <button className="btn ghost sm" onClick={() => setEdit({ id: current.id, title: current.title, body: current.body, importance: current.importance, status: current.status, images: current.images })}>
                    편집
                  </button>
                )}
                {isAdmin && (
                  <button className="btn ghost sm" onClick={() => remove(current)}>삭제</button>
                )}
              </div>
            </div>
            <div className="wiki-view-m">
              <span className={"wiki-imp i" + current.importance}>{impLabel(current.importance)}</span>
              <span className={"wiki-st s-" + current.status}>{stLabel(current.status)}</span>
              <span className="hub-muted">최종 수정 {fmtWhen(current.updatedAt)} · {current.updatedBy}</span>
            </div>
            <WikiBody text={current.body} />
            {current.images.length > 0 && <ImageGrid images={current.images} />}
          </div>
        ) : (
          <div className="hub-muted" style={{ padding: 24 }}>왼쪽에서 글을 고르거나 새 글을 작성하세요.</div>
        )}
      </div>
    </div>
  );
}
