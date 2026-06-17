import { useCallback, useMemo, useRef, useState } from "react";
import type { Student, StudentStatus } from "../types";
import { durTotal, freqLabel, lessonDays, weekCount } from "../lib/logic";
import { GRADE_OPTIONS } from "../lib/grade";
import { GradeBadge, StatusBadge, Empty } from "./ui";
import { Icon } from "../icons";

export type EditField = "name" | "grade" | "status" | "school";
const EDIT_FIELDS: EditField[] = ["name", "grade", "status", "school"];
const STATUS_OPTS: StudentStatus[] = ["재원", "휴원", "퇴원", "대기"];

function valueOf(s: Student, f: EditField): string {
  if (f === "name") return s.name;
  if (f === "school") return s.school || "";
  if (f === "grade") return s.grade;
  return s.status ?? "재원";
}

export function StudentTable({
  list,
  withActions,
  onEdit,
  onPatch,
}: {
  list: Student[];
  withActions: boolean;
  onEdit?: (id: string) => void;
  /** 인라인 저장. 성공 true / 실패 false(호출 측이 원래 값으로 되돌림). */
  onPatch?: (id: string, field: EditField, value: string, orig: string) => Promise<boolean>;
}) {
  const editable = withActions && !!onPatch;
  const [edit, setEdit] = useState<{ id: string; field: EditField } | null>(null);
  const [draft, setDraft] = useState("");
  const [flash, setFlash] = useState<{ id: string; field: EditField; ok: boolean } | null>(null);
  const origRef = useRef("");
  const skipBlur = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const seq = useMemo(() => list.flatMap((s) => EDIT_FIELDS.map((f) => ({ id: s.id, field: f }))), [list]);
  // 학년은 공통 학생명단과 동일한 세부학년(초1~고3)으로 — 따로 놀지 않게.
  const gradeOpts = GRADE_OPTIONS;

  const begin = useCallback(
    (id: string, field: EditField) => {
      const s = list.find((x) => x.id === id);
      if (!s) return;
      const v = valueOf(s, field);
      origRef.current = v;
      setDraft(v);
      setEdit({ id, field });
    },
    [list]
  );
  const close = useCallback(() => setEdit(null), []);

  function doFlash(id: string, field: EditField, ok: boolean) {
    setFlash({ id, field, ok });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1100);
  }

  async function persist(id: string, field: EditField, value: string) {
    const v = field === "name" || field === "school" ? value.trim() : value;
    if (field === "name" && !v) { doFlash(id, field, false); return; } // 이름은 빈값 불가
    if (v === origRef.current) return; // 변경 없음 → 저장/플래시 없음
    const ok = onPatch ? await onPatch(id, field, v, origRef.current) : false;
    doFlash(id, field, ok);
  }
  async function persistClose(id: string, field: EditField, value: string) {
    await persist(id, field, value);
    close();
  }
  async function commitMove(dir: 1 | -1) {
    const cur = edit;
    if (!cur) return;
    await persist(cur.id, cur.field, draft);
    const i = seq.findIndex((x) => x.id === cur.id && x.field === cur.field);
    const nx = seq[i + dir];
    if (nx) begin(nx.id, nx.field);
    else close();
  }

  // 셀렉트 편집 시작 시 드롭다운을 바로 펼쳐보려 시도(브라우저 지원 시).
  const openPicker = useCallback((el: HTMLSelectElement | null) => {
    if (!el) return;
    el.focus();
    try {
      (el as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      /* 사용자 제스처 필요 시 무시 — 탭하면 열림 */
    }
  }, []);

  if (!list.length) return <Empty>표시할 학생이 없습니다.</Empty>;

  const flashCls = (id: string, field: EditField) =>
    flash && flash.id === id && flash.field === field ? (flash.ok ? " cell-ok" : " cell-err") : "";
  const isEditing = (id: string, field: EditField) => edit?.id === id && edit?.field === field;

  function TextCell({ id, field, children }: { id: string; field: EditField; children: React.ReactNode }) {
    if (isEditing(id, field)) {
      return (
        <input
          className="inline-input"
          autoFocus
          aria-label={field === "name" ? "이름" : "학교"}
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); skipBlur.current = true; void persistClose(id, field, draft); }
            else if (e.key === "Escape") { e.preventDefault(); skipBlur.current = true; close(); }
            else if (e.key === "Tab") { e.preventDefault(); skipBlur.current = true; void commitMove(e.shiftKey ? -1 : 1); }
          }}
          onBlur={() => {
            if (skipBlur.current) { skipBlur.current = false; return; }
            void persistClose(id, field, draft);
          }}
        />
      );
    }
    return (
      <button type="button" className={"cell-edit" + flashCls(id, field)} onClick={(e) => { e.stopPropagation(); begin(id, field); }} title="클릭해서 바로 수정">
        {children}
        <span className="cell-pencil"><Icon name="edit" /></span>
        {flash?.ok && flash.id === id && flash.field === field && <span className="saved-tag">저장됨</span>}
      </button>
    );
  }

  function SelectCell({ id, field, opts, children }: { id: string; field: EditField; opts: string[]; children: React.ReactNode }) {
    if (isEditing(id, field)) {
      return (
        <select
          className="inline-select"
          ref={openPicker}
          aria-label={field === "grade" ? "구분" : "상태"}
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { setDraft(e.target.value); skipBlur.current = true; void persistClose(id, field, e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); skipBlur.current = true; close(); }
            else if (e.key === "Tab") { e.preventDefault(); skipBlur.current = true; void commitMove(e.shiftKey ? -1 : 1); }
          }}
          onBlur={() => { if (skipBlur.current) { skipBlur.current = false; return; } close(); }}
        >
          {opts.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    }
    return (
      <button type="button" className={"cell-edit" + flashCls(id, field)} onClick={() => begin(id, field)} title="클릭해서 바로 수정">
        {children}
        <span className="cell-pencil"><Icon name="edit" /></span>
        {flash?.ok && flash.id === id && flash.field === field && <span className="saved-tag">저장됨</span>}
      </button>
    );
  }

  return (
    <table className={"tbl" + (withActions ? " tbl-fixed" : "")}>
      {withActions && (
        <colgroup>
          <col style={{ width: "15%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "10%" }} />
        </colgroup>
      )}
      <thead>
        <tr>
          <th>이름</th>
          <th>구분</th>
          {withActions && <th>상태</th>}
          {withActions && <th>학교</th>}
          <th>첫 등원일</th>
          <th>주 횟수</th>
          <th>요일</th>
          {withActions ? <th style={{ textAlign: "right" }}>수정</th> : <th>비고</th>}
        </tr>
      </thead>
      <tbody>
        {list.map((s) => {
          const chips = lessonDays(s);
          return (
            <tr key={s.id} className={editable ? "tbl-row-click" : undefined} onClick={editable ? () => onEdit?.(s.id) : undefined}>
              <td>
                {editable ? (
                  <TextCell id={s.id} field="name"><span className="t-name">{s.name}</span></TextCell>
                ) : (
                  <span className="t-name">{s.name}</span>
                )}
              </td>
              <td>
                {editable ? (
                  <SelectCell id={s.id} field="grade" opts={gradeOpts}><GradeBadge grade={s.grade} /></SelectCell>
                ) : (
                  <GradeBadge grade={s.grade} />
                )}
              </td>
              {withActions && (
                <td>
                  {editable ? (
                    <SelectCell id={s.id} field="status" opts={STATUS_OPTS}><StatusBadge status={s.status ?? "재원"} /></SelectCell>
                  ) : (
                    <StatusBadge status={s.status ?? "재원"} />
                  )}
                </td>
              )}
              {withActions && (
                <td>
                  {editable ? (
                    <TextCell id={s.id} field="school"><span className="muted">{s.school || "—"}</span></TextCell>
                  ) : (
                    <span className="muted">{s.school || "—"}</span>
                  )}
                </td>
              )}
              <td className="muted">{s.mathStart || s.startDate || "—"}</td>
              <td>
                <span className="badge b-gray">{freqLabel(s)}</span>
              </td>
              <td>
                <div className="dchips">
                  {chips.map((d) => (
                    <span className="dchip" key={d}>{d}</span>
                  ))}
                </div>
              </td>
              {withActions ? (
                <td className="t-actions">
                  <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); onEdit?.(s.id); }}>
                    <Icon name="edit" />
                    수정
                  </button>
                </td>
              ) : (
                <td className="muted">{weekCount(s) ? durTotal(s) + "분/주" : "—"}</td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
