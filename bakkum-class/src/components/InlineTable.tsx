import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { Empty } from "./ui";
import { Icon } from "../icons";

export type ColType = "text" | "number" | "select" | "date" | "readonly";
export interface InlineCol<T> {
  key: string;
  label: string;
  type: ColType;
  width?: string;
  options?: string[]; // select 값 목록
  optionLabels?: Record<string, string>; // select 값 → 표시 라벨
  min?: number;
  max?: number;
  placeholder?: string;
  align?: "left" | "right" | "center";
  /** 현재 값(문자열). */
  get: (row: T) => string;
  /** 표시용 커스텀 렌더(배지 등). 없으면 get/optionLabels로 표시. */
  display?: (row: T) => ReactNode;
}

export interface InlineTableProps<T> {
  rows: T[];
  cols: InlineCol<T>[];
  rowId: (row: T) => string;
  /** 인라인 저장. 성공 true / 실패 false(호출 측이 되돌림 + 안내). */
  onPatch: (id: string, key: string, value: string, orig: string) => Promise<boolean>;
  onDelete?: (id: string) => void;
  empty?: ReactNode;
  /** 날짜 등으로 행을 묶는다 — 그룹마다 '띠 헤더'를 넣고 컬럼 헤더는 맨 위 한 번만. */
  groupBy?: (row: T) => { key: string; label: ReactNode };
}

export function InlineTable<T>({ rows, cols, rowId, onPatch, onDelete, empty, groupBy }: InlineTableProps<T>) {
  const [edit, setEdit] = useState<{ id: string; key: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [flash, setFlash] = useState<{ id: string; key: string; ok: boolean } | null>(null);
  const origRef = useRef("");
  const skipBlur = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editableKeys = cols.filter((c) => c.type !== "readonly").map((c) => c.key);
  const seq = useMemo(
    () => rows.flatMap((r) => editableKeys.map((k) => ({ id: rowId(r), key: k }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows]
  );
  const colByKey = useMemo(() => Object.fromEntries(cols.map((c) => [c.key, c])), [cols]);

  if (!rows.length) return <>{empty ?? <Empty>표시할 항목이 없습니다.</Empty>}</>;

  function rowById(id: string): T | undefined {
    return rows.find((r) => rowId(r) === id);
  }
  function begin(id: string, key: string) {
    const r = rowById(id);
    if (!r) return;
    const v = colByKey[key].get(r);
    origRef.current = v;
    setDraft(v);
    setEdit({ id, key });
  }
  const close = () => setEdit(null);
  function doFlash(id: string, key: string, ok: boolean) {
    setFlash({ id, key, ok });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1100);
  }
  async function persist(id: string, key: string, value: string) {
    const v = value.trim();
    if (v === origRef.current.trim()) return; // 변경 없음
    const ok = await onPatch(id, key, v, origRef.current);
    doFlash(id, key, ok);
  }
  async function persistClose(id: string, key: string, value: string) {
    await persist(id, key, value);
    close();
  }
  async function commitMove(dir: 1 | -1) {
    const cur = edit;
    if (!cur) return;
    await persist(cur.id, cur.key, draft);
    const i = seq.findIndex((x) => x.id === cur.id && x.key === cur.key);
    const nx = seq[i + dir];
    if (nx) begin(nx.id, nx.key);
    else close();
  }
  function onKey(e: React.KeyboardEvent, id: string, key: string) {
    if (e.key === "Enter") { e.preventDefault(); skipBlur.current = true; void persistClose(id, key, draft); }
    else if (e.key === "Escape") { e.preventDefault(); skipBlur.current = true; close(); }
    else if (e.key === "Tab") { e.preventDefault(); skipBlur.current = true; void commitMove(e.shiftKey ? -1 : 1); }
  }
  const openPicker = (el: HTMLSelectElement | null) => {
    if (!el) return;
    el.focus();
    try { (el as HTMLSelectElement & { showPicker?: () => void }).showPicker?.(); } catch { /* 탭하면 열림 */ }
  };

  const flashCls = (id: string, key: string) =>
    flash && flash.id === id && flash.key === key ? (flash.ok ? " cell-ok" : " cell-err") : "";
  const editing = (id: string, key: string) => edit?.id === id && edit?.key === key;

  function renderEditor(id: string, c: InlineCol<T>) {
    if (c.type === "select") {
      return (
        <select
          className="inline-select"
          ref={openPicker}
          aria-label={c.label}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); skipBlur.current = true; void persistClose(id, c.key, e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); skipBlur.current = true; close(); }
            else if (e.key === "Tab") { e.preventDefault(); skipBlur.current = true; void commitMove(e.shiftKey ? -1 : 1); }
          }}
          onBlur={() => { if (skipBlur.current) { skipBlur.current = false; return; } close(); }}
        >
          {(c.options || []).map((o) => (
            <option key={o} value={o}>{c.optionLabels?.[o] ?? o}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        className="inline-input"
        autoFocus
        aria-label={c.label}
        type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"}
        min={c.min}
        max={c.max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => onKey(e, id, c.key)}
        onBlur={() => { if (skipBlur.current) { skipBlur.current = false; return; } void persistClose(id, c.key, draft); }}
      />
    );
  }

  function renderDisplay(r: T, c: InlineCol<T>) {
    if (c.display) return c.display(r);
    const v = c.get(r);
    if (c.type === "select") return <span>{c.optionLabels?.[v] ?? v ?? "—"}</span>;
    return <span className="muted">{v || "—"}</span>;
  }

  function renderRow(r: T) {
    const id = rowId(r);
    return (
      <tr key={id}>
        {cols.map((c) => (
          <td key={c.key} style={c.align === "right" ? { textAlign: "right" } : undefined}>
            {c.type === "readonly" ? (
              renderDisplay(r, c)
            ) : editing(id, c.key) ? (
              renderEditor(id, c)
            ) : (
              <button type="button" className={"cell-edit" + flashCls(id, c.key)} onClick={() => begin(id, c.key)} title="클릭해서 바로 수정">
                {renderDisplay(r, c)}
                <span className="cell-pencil"><Icon name="edit" /></span>
                {flash?.ok && flash.id === id && flash.key === c.key && <span className="saved-tag">저장됨</span>}
              </button>
            )}
          </td>
        ))}
        {onDelete && (
          <td className="t-actions">
            <button className="rep-x" title="삭제" onClick={() => onDelete(id)}>
              <Icon name="trash" />
            </button>
          </td>
        )}
      </tr>
    );
  }

  // 날짜 등으로 그룹핑 (행 순서 유지)
  const groups: { key: string; label: ReactNode; rows: T[] }[] = [];
  if (groupBy) {
    const idx = new Map<string, number>();
    for (const r of rows) {
      const g = groupBy(r);
      let i = idx.get(g.key);
      if (i === undefined) { i = groups.length; idx.set(g.key, i); groups.push({ key: g.key, label: g.label, rows: [] }); }
      groups[i].rows.push(r);
    }
  }
  const totalCols = cols.length + (onDelete ? 1 : 0);

  return (
    <table className={"tbl tbl-fixed" + (groupBy ? " tbl-grouped" : "")}>
      <colgroup>
        {cols.map((c) => (
          <col key={c.key} style={c.width ? { width: c.width } : undefined} />
        ))}
        {onDelete && <col style={{ width: "56px" }} />}
      </colgroup>
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c.key} style={c.align === "right" ? { textAlign: "right" } : undefined}>{c.label}</th>
          ))}
          {onDelete && <th aria-label="삭제" />}
        </tr>
      </thead>
      <tbody>
        {groupBy
          ? groups.map((g) => (
              <Fragment key={"g_" + g.key}>
                <tr className="tbl-grouprow">
                  <td colSpan={totalCols}>
                    <div className="tbl-band">
                      <span className="tbl-band-date">{g.label}</span>
                      <span className="tbl-band-cnt">{g.rows.length}건</span>
                    </div>
                  </td>
                </tr>
                {g.rows.map(renderRow)}
              </Fragment>
            ))
          : rows.map(renderRow)}
      </tbody>
    </table>
  );
}
