// 앱 공통 날짜 컨트롤 — 화면마다 따로 만들지 말고 이걸 쓴다.
//  - DateNav: 하루 단위 이동(‹ 6월 15일 (월) ›  + 오늘로). 출결·일지처럼 '그날'을 보는 화면.
//  - DateField: 네이티브 날짜칸을 우리 형식("2026년 6월 15일 (월)")으로 보여주는 입력. 폼에서.
import { Icon } from "../icons";
import { fmtFull, parseD, todayStr } from "../lib/dates";

/** 하루 단위 날짜 이동 컨트롤. value=YYYY-MM-DD. */
export function DateNav({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isToday = value === todayStr();
  const shift = (delta: number) => {
    const d = parseD(value);
    d.setDate(d.getDate() + delta);
    onChange(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"));
  };
  return (
    <div className="date-nav">
      <button className="date-arrow" onClick={() => shift(-1)} title="어제" aria-label="어제로">‹</button>
      <div className="date-cur">
        {fmtFull(parseD(value))}
        {!isToday && <span className="date-off"> · 오늘 아님</span>}
      </div>
      <button className="date-arrow" onClick={() => shift(1)} title="내일" aria-label="내일로">›</button>
      {!isToday && <button className="btn ghost sm date-today" onClick={() => onChange(todayStr())}>오늘로</button>}
    </div>
  );
}

/** 폼용 날짜 입력 — 네이티브 달력은 그대로 쓰되 표시는 우리 형식으로.
 *  투명한 native input을 위에 덮어 클릭 시 OS 달력이 열리고, 아래엔 한글 형식 텍스트를 보여준다. */
export function DateField({
  value,
  onChange,
  min,
  max,
  placeholder = "날짜 선택",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={"datefield" + (className ? " " + className : "")}>
      <Icon name="cal" />
      <span className={value ? "datefield-val" : "datefield-ph"}>{value ? fmtFull(parseD(value)) : placeholder}</span>
      <input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
