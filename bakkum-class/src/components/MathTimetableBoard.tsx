import { Fragment } from "react";
import { type MathBand } from "../lib/grade";

/* 수학 시간표 보드 — 전체 시간표처럼 요일별 칸, 시간 줄·구분선, 그 밑에 이름표(이름 + 몇 번째 블록 숫자).
 * editable=true(선생님): 칸이 드롭 영역, 이름표를 끌어 옮겨요.
 * editable=false(학생): 넘겨받은 배치만 읽기 전용으로 보여줘요.
 * '시간표 리뉴얼(샘플)'과 학생 수학 화면이 같은 모양을 공유하도록 분리한 컴포넌트예요. */

export interface SampleStudent {
  id: string;
  name: string;
  band: string; // 색 구분용 급 키 — 통합시간표 샘플은 elemLow/elemHigh/mid/high(초저/초고/중/고), 학생 수학화면은 low/high/mid. CSS .tts-{band}.
  grade?: string; // 학년 표기용(예: "초4","중2"). 이름 옆에 보여줌. 없으면 생략.
}

export interface Placement {
  id: string;
  studentId: string;
  week: number; // 주 오프셋(0=이번주, 1=다음주 …)
  day: number; // 0=월 … 6=일
  slot: number; // 시작 시각(분). 14:00=840, 30분 단위.
  specialId?: string; // 있으면 특강 배치
  subject?: "eng"; // 영어 수업(없으면 수학). 영어는 명단에서 가져와 보여만 줌(드래그 편집 X).
}

export type EndType = "date" | "count";
export interface Special {
  id: string;
  name: string;
  color: string;
  endType: EndType;
  endDate: string;
  count: number;
  studentIds: string[];
}

export type DragData =
  | { kind: "new"; studentId: string; specialId?: string }
  | { kind: "move"; placementId: string };

export const DOW = ["월", "화", "수", "목", "금", "토", "일"];
export const SLOT_MIN = 30; // 한 칸 = 30분
export const START_MIN = 14 * 60; // 오후 2:00
export const END_MIN = 22 * 60; // 오후 10:00

/** "HH:MM" → 분. */
export function timeToMin(t: string): number {
  const [h, m] = (t || "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
/** 분 → "오후 2:00" 표기. */
export function fmtTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const period = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${h12}:${String(m).padStart(2, "0")}`;
}
/** 특강 색을 옅게(배경용). */
export function specialStyle(color: string): React.CSSProperties {
  return { background: color + "22", color, borderColor: color };
}

export function Board({
  days,
  slots,
  placements,
  byId,
  specById,
  blockNo,
  onPick,
  editable,
  drag,
  onCellDrop,
  onRemove,
  splitSubject,
}: {
  days: number[];
  slots: number[];
  placements: Placement[];
  byId: Map<string, SampleStudent>;
  specById: Map<string, Special>;
  blockNo: Map<string, number>;
  onPick: (studentId: string) => void;
  editable: boolean;
  drag?: React.MutableRefObject<DragData | null>;
  onCellDrop?: (day: number, slot: number, subject?: "math" | "eng") => void;
  onRemove?: (placementId: string) => void;
  splitSubject?: boolean; // 요일마다 영어 칸 / 수학 칸으로 나눠 보여줘요(통합 시간표용).
}) {
  // 이름표 1개 렌더(공용).
  const renderTag = (p: Placement) => {
    const s = byId.get(p.studentId);
    if (!s) return null;
    const sp = p.specialId ? specById.get(p.specialId) : undefined;
    const canDrag = editable;
    return (
      <span
        key={p.id}
        className={"tts-tag" + (sp ? " special" : " tts-" + s.band)}
        style={sp ? specialStyle(sp.color) : undefined}
        draggable={canDrag}
        onDragStart={canDrag && drag ? (e) => { drag.current = { kind: "move", placementId: p.id }; e.dataTransfer.effectAllowed = "move"; } : undefined}
        onDragEnd={canDrag && drag ? () => { drag.current = null; } : undefined}
        title={editable ? "끌어서 옮기거나, 옆 ×로 빼요. 이름을 누르면 정보를 봐요" : "이름을 누르면 정보를 봐요"}
      >
        <span
          className="tts-tag-name as-link"
          role="button"
          tabIndex={0}
          onClick={() => onPick(p.studentId)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(p.studentId); } }}
          title="학생 정보 보기"
        >
          {sp ? `${s.name} ${sp.name}` : s.name}
        </span>
        {!sp && s.grade && <span className="tts-tag-grade">{s.grade}</span>}
        <span className="tts-tag-n">{blockNo.get(p.id) ?? ""}</span>
        {editable && onRemove && (
          <button type="button" className="tts-tag-x" draggable={false} onClick={(e) => { e.stopPropagation(); onRemove(p.id); }} onDragStart={(e) => e.preventDefault()} title="이 블록 빼기" aria-label="이 블록 빼기">×</button>
        )}
      </span>
    );
  };
  // 칸 1개 렌더. sub: "eng"=영어칸 / "math"=수학칸(특강 포함) / undefined=합친 칸.
  const cell = (day: number, slot: number, sub?: "math" | "eng", showTime = false) => {
    const here = placements.filter((p) => p.day === day && p.slot === slot && (sub === undefined ? true : sub === "eng" ? p.subject === "eng" : p.subject !== "eng"));
    return (
      <div
        className={"tts-slot" + (here.length ? " has" : "")}
        onDragOver={editable ? (e) => { e.preventDefault(); e.currentTarget.classList.add("over"); } : undefined}
        onDragLeave={editable ? (e) => e.currentTarget.classList.remove("over") : undefined}
        onDrop={editable ? (e) => { e.preventDefault(); e.currentTarget.classList.remove("over"); onCellDrop?.(day, slot, sub); } : undefined}
      >
        {showTime && <span className="tts-slot-time">{fmtTime(slot)}</span>}
        <div className="tts-slot-names">{here.map(renderTag)}</div>
      </div>
    );
  };

  // 분할 모드 — 요일마다 영어·수학 두 칸. 왼쪽 시간 열 + CSS Grid로 행을 맞춰요.
  if (splitSubject) {
    return (
      <div className="tts-board split" style={{ gridTemplateColumns: `64px repeat(${days.length}, 1fr 1fr)` }}>
        <div className="tts-gh tts-gh-time">시간</div>
        {days.map((day) => <div className="tts-gh tts-gh-day" key={"h" + day} style={{ gridColumn: "span 2" }}>{DOW[day]}</div>)}
        <div className="tts-gsub" />
        {days.map((day) => (
          <Fragment key={"s" + day}>
            <div className="tts-gsub eng">영어</div>
            <div className="tts-gsub math">수학</div>
          </Fragment>
        ))}
        {slots.map((slot) => (
          <Fragment key={slot}>
            <div className="tts-gtime">{fmtTime(slot)}</div>
            {days.map((day) => (
              <Fragment key={day + "-" + slot}>
                {cell(day, slot, "eng")}
                {cell(day, slot, "math")}
              </Fragment>
            ))}
          </Fragment>
        ))}
      </div>
    );
  }

  // 합친 모드(기존) — 요일별 한 칸.
  return (
    <div className="tts-board">
      {days.map((day) => (
        <div className="tts-daycol" key={day}>
          <div className="tts-daycol-h">{DOW[day]}</div>
          {slots.map((slot) => <Fragment key={slot}>{cell(day, slot, undefined, true)}</Fragment>)}
        </div>
      ))}
    </div>
  );
}

/** 학생 수학 화면 임베드용 — 한 학생의 수학 시간표(학생 보기, 읽기 전용). Board를 그대로 재사용. */
export function MathTimetableStudentView({
  slots,
  band = "mid",
  studentName = "",
}: {
  slots: { day: string; time: string; duration: number }[];
  band?: MathBand;
  studentName?: string;
}) {
  const stu: SampleStudent = { id: "me", name: studentName, band };
  const byId = new Map([[stu.id, stu]]);
  const placements: Placement[] = [];
  let k = 0;
  for (const sl of slots) {
    const day = DOW.indexOf(sl.day);
    if (day < 0) continue;
    const start = timeToMin(sl.time);
    const blocks = Math.max(1, Math.round((sl.duration || 30) / SLOT_MIN));
    for (let b = 0; b < blocks; b++) placements.push({ id: `m${++k}`, studentId: stu.id, week: 0, day, slot: start + b * SLOT_MIN });
  }
  if (!placements.length) return <div className="sp-muted">등록된 수학 수업이 없어요.</div>;

  const daySet = new Set<number>([0, 1, 2, 3, 4]);
  for (const p of placements) daySet.add(p.day);
  const days = [...daySet].sort((a, b) => a - b);

  let lo = START_MIN, hi = END_MIN;
  for (const p of placements) { lo = Math.min(lo, p.slot); hi = Math.max(hi, p.slot + SLOT_MIN); }
  const timeSlots: number[] = [];
  for (let m = lo; m < hi; m += SLOT_MIN) timeSlots.push(m);

  const blockNo = new Map<string, number>();
  let n = 0;
  [...placements].sort((a, b) => a.day - b.day || a.slot - b.slot).forEach((p) => blockNo.set(p.id, ++n));

  return (
    <Board
      days={days}
      slots={timeSlots}
      placements={placements}
      byId={byId}
      specById={new Map()}
      blockNo={blockNo}
      onPick={() => {}}
      editable={false}
    />
  );
}

/** 컴팩트 시간표(대학 '에타' 느낌) — 수업을 시작~끝 한 덩어리 블록으로, 빈 시간은 줄을 안 만들어 짧게.
 *  학생 화면용. 수업 있는 요일만 열로 보여줘 모바일에서도 좁게 들어가요. */
function fmtHourLabel(min: number): string {
  const h = Math.floor(min / 60);
  const period = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${h12}`;
}
export function MathTimetableCompact({ slots, band = "mid" }: { slots: { day: string; time: string; duration: number }[]; band?: MathBand }) {
  const blocks: { day: number; start: number; end: number }[] = [];
  for (const sl of slots) {
    const day = DOW.indexOf(sl.day);
    if (day < 0) continue;
    const start = timeToMin(sl.time);
    const dur = Math.max(SLOT_MIN, sl.duration || SLOT_MIN);
    blocks.push({ day, start, end: start + dur });
  }
  if (!blocks.length) return <div className="sp-muted">아직 등록된 수업 시간이 없어요. 선생님이 시간표를 입력하면 여기에 보여요.</div>;

  const days = [...new Set(blocks.map((b) => b.day))].sort((a, b) => a - b);
  let base = Math.min(...blocks.map((b) => b.start));
  let end = Math.max(...blocks.map((b) => b.end));
  base = Math.floor(base / 60) * 60;
  end = Math.ceil(end / 60) * 60;
  const total = Math.max(60, end - base);
  const PX = 0.66; // 1분당 픽셀 — 1시간 ≈ 40px(컴팩트)
  const bodyH = total * PX;
  const hours: number[] = [];
  for (let h = base; h <= end; h += 60) hours.push(h);

  return (
    <div className="ett">
      <div className="ett-head" style={{ gridTemplateColumns: `38px repeat(${days.length}, minmax(0,1fr))` }}>
        <div className="ett-corner" />
        {days.map((d) => <div className="ett-day" key={d}>{DOW[d]}</div>)}
      </div>
      <div className="ett-body" style={{ gridTemplateColumns: `38px repeat(${days.length}, minmax(0,1fr))`, height: bodyH }}>
        <div className="ett-times">
          {hours.map((h) => <span className="ett-hlabel" key={h} style={{ top: (h - base) * PX }}>{fmtHourLabel(h)}</span>)}
        </div>
        {days.map((d) => (
          <div className="ett-col" key={d}>
            {hours.map((h) => <div className="ett-line" key={h} style={{ top: (h - base) * PX }} />)}
            {blocks.filter((b) => b.day === d).map((b, i) => (
              <div
                key={i}
                className={"ett-block ett-" + band}
                style={{ top: (b.start - base) * PX, height: Math.max(18, (b.end - b.start) * PX - 2) }}
              >
                <b>수학</b>
                <span>{fmtTime(b.start)}~{fmtTime(b.end)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 주간 시간표(수학·영어 함께) — 학생 화면 공용.
 *  - 영수 둘 다 듣는 학생: 두 과목 블록을 한 시간표에 함께(겹치면 좌우로 나눠서).
 *  - 한 과목만 듣는 학생: 그 과목만(빈 배열은 안 그려짐).
 *  - 위아래로 1시간 여유를 둬서 시간 글씨가 잘리지 않게. */
type TTSlot = { day: string; time: string; duration: number };
type TTBlock = { day: number; start: number; end: number; subject: "math" | "eng" };
export function WeekTimetable({ math = [], eng = [] }: { math?: TTSlot[]; eng?: TTSlot[] }) {
  const blocks: TTBlock[] = [];
  const collect = (arr: TTSlot[], subject: "math" | "eng") => {
    for (const sl of arr) {
      const day = DOW.indexOf(sl.day);
      if (day < 0) continue;
      const start = timeToMin(sl.time);
      const dur = Math.max(SLOT_MIN, sl.duration || SLOT_MIN);
      blocks.push({ day, start, end: start + dur, subject });
    }
  };
  collect(math, "math");
  collect(eng, "eng");
  if (!blocks.length) return <div className="sp-muted">아직 등록된 수업 시간이 없어요. 선생님이 시간표를 입력하면 여기에 보여요.</div>;

  const days = [...new Set(blocks.map((b) => b.day))].sort((a, b) => a - b);
  // 앞뒤로 1시간씩 여유 — 첫·끝 시간 글씨가 잘리지 않도록.
  let base = Math.floor(Math.min(...blocks.map((b) => b.start)) / 60) * 60 - 60;
  base = Math.max(0, base);
  const end = Math.min(24 * 60, Math.ceil(Math.max(...blocks.map((b) => b.end)) / 60) * 60 + 60);
  const total = Math.max(60, end - base);
  const PX = 0.66; // 1분당 픽셀
  const bodyH = total * PX;
  const hours: number[] = [];
  for (let h = base; h <= end; h += 60) hours.push(h);

  // 같은 요일에 시간이 겹치는 블록은 좌우 레인으로 나눠서 — 글씨가 겹치거나 잘리지 않게.
  function lanesFor(dayBlocks: TTBlock[]) {
    const lanes: TTBlock[][] = [];
    const laneOf = new Map<TTBlock, number>();
    for (const b of dayBlocks) {
      let placed = false;
      for (let l = 0; l < lanes.length; l++) {
        if (lanes[l].every((x) => b.start >= x.end || b.end <= x.start)) {
          lanes[l].push(b); laneOf.set(b, l); placed = true; break;
        }
      }
      if (!placed) { laneOf.set(b, lanes.length); lanes.push([b]); }
    }
    const n = Math.max(1, lanes.length);
    return dayBlocks.map((b) => ({ b, lane: laneOf.get(b) || 0, lanes: n }));
  }

  return (
    <div className="ett">
      <div className="ett-head" style={{ gridTemplateColumns: `38px repeat(${days.length}, minmax(0,1fr))` }}>
        <div className="ett-corner" />
        {days.map((d) => <div className="ett-day" key={d}>{DOW[d]}</div>)}
      </div>
      <div className="ett-body" style={{ gridTemplateColumns: `38px repeat(${days.length}, minmax(0,1fr))`, height: bodyH }}>
        <div className="ett-times">
          {hours.map((h) => <span className="ett-hlabel" key={h} style={{ top: (h - base) * PX }}>{fmtHourLabel(h)}</span>)}
        </div>
        {days.map((d) => {
          const dayBlocks = blocks.filter((b) => b.day === d).sort((a, b) => a.start - b.start);
          const laid = lanesFor(dayBlocks);
          return (
            <div className="ett-col" key={d}>
              {hours.map((h) => <div className="ett-line" key={h} style={{ top: (h - base) * PX }} />)}
              {laid.map(({ b, lane, lanes }, i) => {
                const w = 100 / lanes;
                return (
                  <div
                    key={i}
                    className={"ett-block ett-" + (b.subject === "math" ? "math" : "eng")}
                    style={{
                      top: (b.start - base) * PX,
                      height: Math.max(18, (b.end - b.start) * PX - 2),
                      left: `calc(${lane * w}% + 2px)`,
                      width: `calc(${w}% - 4px)`,
                      right: "auto",
                    }}
                  >
                    <b>{b.subject === "math" ? "수학" : "영어"}</b>
                    <span>{fmtTime(b.start)}~{fmtTime(b.end)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
