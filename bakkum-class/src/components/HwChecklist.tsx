// 숙제 체크리스트 — 학생 '오늘의 숙제' = 강사 '내줄 숙제' 공용.
// 항목마다 완료/미흡/안함/없음 상태 + 작성자(학생 초록 / 강사 주황 + 이름) 표기. 양방향 편집.
import { useState } from "react";
import { HW_STATUSES, type HwItem, type HwStatus } from "../lib/engApi";
import { Icon } from "../icons";

export function HwChecklist({ items, onChange, currentBy, currentByName, placeholder = "숙제 추가 (예: 단어 3과 외우기)", readOnly = false }: {
  items: HwItem[];
  onChange: (next: HwItem[]) => void;
  currentBy: "student" | "teacher";
  currentByName: string;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const [text, setText] = useState("");

  const stamp = <T extends HwItem>(it: T): T => ({ ...it, by: currentBy, byName: currentByName });
  const setStatus = (i: number, s: HwStatus) =>
    onChange(items.map((x, j) => (j === i ? stamp({ ...x, status: x.status === s ? "" : s }) : x)));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));
  const add = () => {
    const t = text.trim();
    if (!t) return;
    if (items.some((x) => x.text === t)) { setText(""); return; }
    onChange([...items, stamp({ text: t, status: "" })]);
    setText("");
  };

  return (
    <div className="hwc">
      {items.map((it, i) => {
        const byCls = it.by === "student" ? "stu" : it.by === "teacher" ? "tea" : "";
        return (
          <div className="hwc-row" key={i}>
            <span className="hwc-text">{it.text}</span>
            <div className="hwc-seg">
              {HW_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={"hwc-st" + (it.status === s ? " on " + byCls : "")}
                  disabled={readOnly}
                  onClick={() => setStatus(i, s)}
                >{s}</button>
              ))}
            </div>
            {it.status && it.byName && (
              <span className={"hwc-by " + byCls} title={(it.by === "student" ? "학생이 선택" : "강사 최종 선택") + " · " + it.byName}>
                {it.by === "student" ? "학생 입력" : "최종: " + it.byName}
              </span>
            )}
            {!readOnly && <button type="button" className="hwc-x" onClick={() => remove(i)} aria-label="삭제">×</button>}
          </div>
        );
      })}
      {!readOnly && (
        <div className="hwc-add">
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) add(); }} placeholder={placeholder} />
          <button type="button" className="btn ghost sm" onClick={add} disabled={!text.trim()}><Icon name="plus" /> 추가</button>
        </div>
      )}
      {items.length === 0 && readOnly && <span className="hwc-empty">아직 숙제가 없어요.</span>}
    </div>
  );
}
