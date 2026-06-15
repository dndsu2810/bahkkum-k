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
  /** 그룹 헤더를 클릭해 접고 펼친다. 기록이 쌓여도 화면이 길어지지 않게. */
  collapsible?: boolean;
  /** 접힌 그룹 헤더에 보여줄 요약(예: '출석 15 · 지각 1 · 결석 1'). */
  groupSummary?: (rows: T[]) => string;
  /** 처음에 펼쳐둘 그룹(예: 오늘·어제). 없으면 첫 그룹만 펼침. (key, index) → 펼침 여부. */
  openInitially?: (key: string, index: number) => boolean;
  /** 처음에 보여줄 그룹 수. 나머지는 '+ 이전 기록 더 보기'로. */
  pageSize?: number;
}

export function InlineTable<T>({ rows, cols, rowId, onPatch, onDelete, empty, groupBy, collapsible, groupSummary, openInitially, pageSize }: InlineTableProps<T>) {
  // 그룹 접힘/펼침 사용자 토글(없으면 openInitially 기본값). 데이터 새로고침에도 유지.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState(pageSize ?? Infinity);
  const toggleGroup = (key: string, def: boolean) => setOpenMap((m) => ({ ...m, [key]: !(key in m ? m[key] : def) }));
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
  // 백그라운드 저장 — UI를 막지 않는다. 결과는 flash로만 표시. orig는 호출 시점 값을 캡처.
  function fireSave(id: string, key: string, value: string, orig: string) {
    const v = value.trim();
    if (v === orig.trim()) return; // 변경 없음
    void onPatch(id, key, v, orig).then((ok) => doFlash(id, key, ok));
  }
  // 편집 확정: 먼저 즉시 닫고(다음 셀 편집을 막지 않게) 저장은 뒤에서 진행.
  function persistClose(id: string, key: string, value: string) {
    const orig = origRef.current;
    close();
    fireSave(id, key, value, orig);
  }
  function commitMove(dir: 1 | -1) {
    const cur = edit;
    if (!cur) return;
    const orig = origRef.current;
    fireSave(cur.id, cur.key, draft, orig); // 저장은 백그라운드
    const i = seq.findIndex((x) => x.id === cur.id && x.key === cur.key);
    const nx = seq[i + dir];
    if (nx) begin(nx.id, nx.key); // 바로 다음 셀로 (저장 대기 없음)
    else close();
  }
  function onKey(e: React.KeyboardEvent, id: string, key: string) {
    if (e.key === "Enter") { e.preventDefault(); skipBlur.current = true; persistClose(id, key, draft); }
    else if (e.key === "Escape") { e.preventDefault(); skipBlur.current = true; close(); }
    else if (e.key === "Tab") { e.preventDefault(); skipBlur.current = true; commitMove(e.shiftKey ? -1 : 1); }
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
          ? groups.slice(0, shown).map((g, gi) => {
              const def = collapsible ? (openInitially ? openInitially(g.key, gi) : gi === 0) : true;
              const open = collapsible ? (g.key in openMap ? openMap[g.key] : def) : true;
              return (
                <Fragment key={"g_" + g.key}>
                  <tr className={"tbl-grouprow" + (collapsible ? " is-toggle" : "")}>
                    <td colSpan={totalCols}>
                      {collapsible ? (
                        <button type="button" className="tbl-band tbl-band-btn" onClick={() => toggleGroup(g.key, def)} aria-expanded={open}>
                          <span className={"tbl-band-arrow" + (open ? " open" : "")}><Icon name="chev" /></span>
                          <span className="tbl-band-date">{g.label}</span>
                          <span className="tbl-band-cnt">{g.rows.length}건</span>
                          {!open && groupSummary && <span className="tbl-band-sum">{groupSummary(g.rows)}</span>}
                        </button>
                      ) : (
                        <div className="tbl-band">
                          <span className="tbl-band-date">{g.label}</span>
                          <span className="tbl-band-cnt">{g.rows.length}건</span>
                        </div>
                      )}
                    </td>
                  </tr>
                  {open && g.rows.map(renderRow)}
                </Fragment>
              );
            })
          : rows.map(renderRow)}
        {groupBy && groups.length > shown && (
          <tr className="tbl-morerow">
            <td colSpan={totalCols}>
              <button type="button" className="tbl-more" onClick={() => setShown((n) => n + (pageSize ?? 14))}>
                + 이전 기록 더 보기 ({groups.length - shown}일 더)
              </button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
