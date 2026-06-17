import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import { wikiApi, type WikiPage, type WikiStatus } from "../lib/hubApi";
import { fmtWhen } from "../lib/dates";
import { ImageGrid } from "../components/ImageGrid";
import { copyText } from "../lib/report";

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
            <textarea
              className="input wiki-body-edit"
              rows={16}
              value={edit.body}
              onChange={(e) => setEdit({ ...edit, body: e.target.value })}
              placeholder="본문 (자유 입력)"
            />
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
