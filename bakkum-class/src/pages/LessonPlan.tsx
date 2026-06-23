import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import { useStore } from "../store";
import { Icon } from "../icons";
import { getConfig, setConfig } from "../lib/configApi";
import { getRoster } from "../lib/rosterApi";

// 연간 수업 계획표 — 주 단위 간트(캘린더형). 일정에 시작~끝(월·주차)을 정하면 달 경계를 넘어
// 이어지는 막대로 그려진다. 사이드 항목은 '대분류'로 묶어 반(초등·중고등·고백클래스 등)별로 구성.
// 저장: 행 구조는 class_config의 'math_plan_rows2', 막대는 연도별 'math_plan_bars_<y>'.

const MONTHS = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

// 그 달에 들어있는 월요일들의 '일'. 예: 2026년 6월 → [1, 8, 15, 22, 29]. (한 달의 주차 = 월요일 개수)
function mondays(y: number, m: number): number[] {
  const out: number[] = [];
  const d = new Date(y, m, 1);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1); // 그 달 첫 월요일로
  while (d.getMonth() === m) { out.push(d.getDate()); d.setDate(d.getDate() + 7); }
  return out.length ? out : [1]; // 안전장치
}

// 행은 고유 id로 식별 — 복제하면 같은 이름이라도 일정(막대)이 서로 독립돼야 하므로.
// split=대상별로 줄 나눠 표시(겹쳐도 안 가려지게 아래로 늘림).
interface PlanRow { id: string; group: string; cat: string; item: string; split?: boolean }
// 일정 막대: 시작월(sm)·시작주차(sw) ~ 끝월(em)·끝주차(ew). 주차는 그 달 안에서 1부터.
// done=완료(회색), t=대상(학생/반 코드: A 전부·G 고백클래스·E 초등·M 중등·H 고등·또는 학생 이름).
interface Bar { n: string; d: string; sm: number; sw: number; em: number; ew: number; done?: boolean; t?: string }
// 대상 빠른 버튼.
const TARGET_QUICK: { label: string; code: string }[] = [
  { label: "전부", code: "A" }, { label: "고백클래스", code: "G" }, { label: "초등", code: "E1~6" }, { label: "중등", code: "M1~3" }, { label: "고등", code: "H1~3" },
];
// 대분류별 막대 색 — 파스텔(연한) 프리셋. 연한 배경이라 막대 글씨는 진한 색으로 표시.
const GROUP_PALETTE = ["#FCE0A8", "#CFE3F7", "#CDEBD6", "#F8D3DE", "#E2D6F5", "#FBDCC4", "#CDEAEE", "#DCE0E8"];
const DEFAULT_BAR_COLOR = "#FBE3B3"; // 대분류 색 미지정 시 기본(연한 honey)
let _seq = 0;
function newId(): string { return "r" + Date.now().toString(36) + (_seq++).toString(36); }

const DEFAULT_ROWS: PlanRow[] = [
  { id: "d0", group: "", cat: "학기 진도", item: "예습" },
  { id: "d1", group: "", cat: "학기 진도", item: "복습" },
  { id: "d2", group: "", cat: "학기 진도", item: "고백클래스" },
  { id: "d3", group: "", cat: "시험대비", item: "중간고사" },
  { id: "d4", group: "", cat: "시험대비", item: "기말고사" },
  { id: "d5", group: "", cat: "KTC 수학경시대회", item: "수학경시대회" },
  { id: "d6", group: "", cat: "주간 테스트", item: "주간 테스트" },
  { id: "d7", group: "", cat: "주간 테스트", item: "월말 학습 리포트" },
  { id: "d8", group: "", cat: "특강", item: "서술형&문해력 특강" },
  { id: "d9", group: "", cat: "특강", item: "Game Day" },
  { id: "d10", group: "", cat: "학기 마무리", item: "문제집 마무리" },
  { id: "d11", group: "", cat: "학기 마무리", item: "학기 진도 마무리" },
  { id: "d12", group: "", cat: "학기 마무리", item: "다음 학기 준비" },
];

// 기본 막대(월 기준 요약) — 비어 보이지 않게. cat|item|월 → 그 달 한 칸짜리 막대.
const DEFAULT_CELLS: Record<string, string> = {
  "학기 진도|예습|0": "1학기 진도 예습(A)",
  "학기 진도|예습|6": "2학기 진도 예습(A)",
  "학기 진도|복습|2": "1학기 복습+연산(A)",
  "학기 진도|복습|8": "2학기 복습+연산(A)",
  "학기 진도|고백클래스|0": "30일/50일 수학(G)",
  "시험대비|중간고사|3": "1학기 중간고사(M1~H3)",
  "시험대비|중간고사|9": "2학기 중간고사(M1~H3)",
  "시험대비|기말고사|5": "1학기 기말고사(M1~H3)",
  "시험대비|기말고사|11": "2학기 기말고사(M1~H3)",
  "주간 테스트|주간 테스트|0": "매주 수·목 진행(A)",
  "주간 테스트|월말 학습 리포트|0": "1월(A)", "주간 테스트|월말 학습 리포트|1": "2월(A)", "주간 테스트|월말 학습 리포트|2": "3월(A)",
  "주간 테스트|월말 학습 리포트|3": "4월(A)", "주간 테스트|월말 학습 리포트|4": "5월(A)", "주간 테스트|월말 학습 리포트|5": "6월(A)",
  "주간 테스트|월말 학습 리포트|6": "7월(A)", "주간 테스트|월말 학습 리포트|7": "8월(A)", "주간 테스트|월말 학습 리포트|8": "9월(A)",
  "주간 테스트|월말 학습 리포트|9": "10월(A)", "주간 테스트|월말 학습 리포트|10": "11월(A)", "주간 테스트|월말 학습 리포트|11": "12월(A)",
  "특강|서술형&문해력 특강|4": "서술형&문해력 특강(E5~6)",
  "특강|Game Day|2": "3월(A)", "특강|Game Day|4": "5월(A)", "특강|Game Day|6": "7월(A)",
  "특강|Game Day|8": "9월(A)", "특강|Game Day|9": "10월(A)", "특강|Game Day|11": "12월(A)",
  "학기 마무리|문제집 마무리|5": "학기 마무리(호평초)",
  "학기 마무리|학기 진도 마무리|6": "학기 마무리(A)", "학기 마무리|학기 진도 마무리|11": "학기 마무리(A)",
};

// ─ 저장 키 ─
const ROWS_KEY = "math_plan_rows2";        // 대분류 포함 행 구조(신규)
const GROUP_COLORS_KEY = "math_plan_group_colors"; // 대분류별 색상 { 대분류: 색 }
const OLD_ROWS_KEY = "math_year_plan_rows"; // 구버전 행(분류·항목만)
const barsKey = (y: number) => `math_plan_bars_${y}`;
const OLD_LEGACY = "math_year_plan";
const oldYearKey = (y: number) => `math_year_plan_${y}`;

function rowsFor(cfg: Record<string, string>): PlanRow[] {
  const raw = cfg[ROWS_KEY];
  if (raw) {
    try {
      const a = JSON.parse(raw);
      if (Array.isArray(a) && a.length) return a.map((r) => ({ id: String(r.id || newId()), group: String(r.group || ""), cat: String(r.cat || ""), item: String(r.item || ""), split: !!r.split })).filter((r) => r.cat && r.item);
    } catch { /* 깨졌으면 아래로 */ }
  }
  const old = cfg[OLD_ROWS_KEY]; // 구버전 행을 대분류 없이 가져옴
  if (old) {
    try {
      const a = JSON.parse(old);
      if (Array.isArray(a) && a.length) return a.map((r) => ({ id: newId(), group: "", cat: String(r.cat || ""), item: String(r.item || "") })).filter((r) => r.cat && r.item);
    } catch { /* 기본값 */ }
  }
  return DEFAULT_ROWS;
}
// 저장된 막대는 id 기준이지만, 구버전은 'cat|item' 키로 저장돼 있어 행 id로 옮겨 정규화한다.
function normalizeBars(raw: Record<string, Bar[]>, rows: PlanRow[]): Record<string, Bar[]> {
  const map: Record<string, string> = {};
  for (const r of rows) { map[r.id] = r.id; const ck = `${r.cat}|${r.item}`; if (!(ck in map)) map[ck] = r.id; }
  const out: Record<string, Bar[]> = {};
  for (const k in raw) { const id = map[k]; if (id) (out[id] ||= []).push(...(raw[k] || [])); }
  return out;
}

// 구버전 셀(월 단위) → 막대로 변환. 셀에 기간(w=[s,e])이 있으면 그대로, 없으면 그 달 한 칸.
function cellsToBars(cells: Record<string, unknown>, y: number): Record<string, Bar[]> {
  const out: Record<string, Bar[]> = {};
  for (const k in cells) {
    const parts = k.split("|");
    if (parts.length < 3) continue;
    const cat = parts[0], item = parts[1], m = Number(parts[2]);
    if (isNaN(m)) continue;
    const v = cells[k] as string | { n?: string; d?: string; w?: [number, number] };
    const n = typeof v === "string" ? v : String(v?.n || "");
    const d = typeof v === "string" ? "" : String(v?.d || "");
    const w = typeof v === "string" ? null : v?.w || null;
    if (!n && !d) continue;
    // '매주' 진행 일정은 그 달 한 칸이 아니라 학년 끝(12월)까지 길게 — 안 보이던 문제 해결.
    const weekly = /매주/.test(n);
    const sw = w ? w[0] : 1;
    const em = weekly ? 11 : m;
    const ew = weekly ? mondays(y, 11).length : (w ? w[1] : mondays(y, m).length);
    (out[`${cat}|${item}`] ||= []).push({ n, d, sm: m, sw, em, ew });
  }
  return out;
}
function defaultBars(y: number): Record<string, Bar[]> {
  return cellsToBars(DEFAULT_CELLS, y);
}
function barsFor(cfg: Record<string, string>, y: number, rows: PlanRow[]): Record<string, Bar[]> {
  const raw = cfg[barsKey(y)];
  if (raw) { try { return normalizeBars(JSON.parse(raw), rows); } catch { /* 아래로 */ } }
  const oldRaw = cfg[oldYearKey(y)] ?? cfg[OLD_LEGACY]; // 구버전 셀 마이그레이션
  if (oldRaw) { try { return normalizeBars(cellsToBars(JSON.parse(oldRaw), y), rows); } catch { /* 기본값 */ } }
  return normalizeBars(defaultBars(y), rows);
}

// ─ 일정(막대) 입력 모달 ─
function BarModal({ weeks, defMonth, bar, roster, onSave, onDelete }: { weeks: number[][]; defMonth: number; bar?: Bar; roster: string[]; onSave: (b: Bar) => void; onDelete?: () => void }) {
  const { closeModal } = useStore();
  const [n, setN] = useState(bar?.n || "");
  const [d, setD] = useState(bar?.d || "");
  const [t, setT] = useState(bar?.t || "");
  const [sm, setSm] = useState(bar ? bar.sm : defMonth);
  const [sw, setSw] = useState(bar ? bar.sw : 1);
  const [em, setEm] = useState(bar ? bar.em : defMonth);
  const [ew, setEw] = useState(bar ? bar.ew : 1);
  const [done, setDone] = useState(!!bar?.done);
  const wkOpts = (m: number) => weeks[m].map((day, i) => ({ v: i + 1, label: `${i + 1}주차 (${day}일~)` }));
  const before = em < sm || (em === sm && ew < sw); // 끝이 시작보다 앞이면 경고
  const addStudent = (name: string) => { if (!name) return; setT((cur) => (cur.trim() ? cur.trim() + ", " + name : name)); };
  function save() {
    const name = n.trim();
    if (!name) return;
    const S = { m: sm, w: Math.min(sw, weeks[sm].length) };
    let E = { m: em, w: Math.min(ew, weeks[em].length) };
    if (E.m < S.m || (E.m === S.m && E.w < S.w)) E = { ...S }; // 끝<시작이면 시작에 맞춤
    onSave({ n: name, d: d.trim(), sm: S.m, sw: S.w, em: E.m, ew: E.w, done, t: t.trim() });
    closeModal();
  }
  return (
    <>
      <div className="modal-head">
        <div className="modal-title">{bar ? "일정 수정" : "일정 추가"}</div>
        <button className="modal-x" onClick={closeModal} aria-label="닫기"><Icon name="x" /></button>
      </div>
      <div className="modal-body">
        <label className="plan-flabel">일정명</label>
        <input className="input" value={n} onChange={(e) => setN(e.target.value)} placeholder="예: 1학기 중간고사 대비" autoFocus />

        <label className="plan-flabel" style={{ marginTop: 14 }}>기간</label>
        <div className="plan-period">
          <div className="plan-period-row">
            <span className="plan-period-tag">시작</span>
            <select className="input" value={sm} onChange={(e) => { const m = Number(e.target.value); setSm(m); if (sw > weeks[m].length) setSw(weeks[m].length); }}>
              {MONTHS.map((mn, m) => <option key={m} value={m}>{mn}</option>)}
            </select>
            <select className="input" value={sw} onChange={(e) => setSw(Number(e.target.value))}>
              {wkOpts(sm).map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div className="plan-period-row">
            <span className="plan-period-tag">끝</span>
            <select className="input" value={em} onChange={(e) => { const m = Number(e.target.value); setEm(m); if (ew > weeks[m].length) setEw(weeks[m].length); }}>
              {MONTHS.map((mn, m) => <option key={m} value={m}>{mn}</option>)}
            </select>
            <select className="input" value={ew} onChange={(e) => setEw(Number(e.target.value))}>
              {wkOpts(em).map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          {before && <div className="plan-period-warn">끝이 시작보다 앞이에요 — 저장하면 시작에 맞춰집니다.</div>}
        </div>

        <label className="plan-flabel" style={{ marginTop: 14 }}>대상 (학생) <span className="plan-flabel-opt">선택 · 전부A·고백G·초등E·중M·고H 또는 학생 이름</span></label>
        <div className="plan-target-quick">
          {TARGET_QUICK.map((q) => <button key={q.code} type="button" className="btn ghost sm" onClick={() => setT(q.code)}>{q.label}</button>)}
        </div>
        <input className="input" value={t} onChange={(e) => setT(e.target.value)} placeholder="예: E5~6, M1~H3, 또는 학생 이름" style={{ marginTop: 8 }} />
        {roster.length > 0 && (
          <select className="input" value="" onChange={(e) => { addStudent(e.target.value); e.target.value = ""; }} style={{ marginTop: 8 }}>
            <option value="">명단에서 학생 추가…</option>
            {roster.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}

        <label className="plan-week-toggle" style={{ marginTop: 14 }}><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> 완료 처리 (회색으로 표시)</label>

        <label className="plan-flabel" style={{ marginTop: 14 }}>상세설명 <span className="plan-flabel-opt">선택</span></label>
        <textarea className="input plan-cell-ta" value={d} onChange={(e) => setD(e.target.value)} rows={4} placeholder="범위·준비물 등 자세한 내용 (줄바꿈 가능)" />
      </div>
      <div className="modal-foot">
        {onDelete && <button className="btn ghost danger" style={{ marginRight: "auto" }} onClick={() => { onDelete(); closeModal(); }}>삭제</button>}
        <button className="btn ghost" onClick={closeModal}>취소</button>
        <button className="btn primary" disabled={!n.trim()} onClick={save}>저장</button>
      </div>
    </>
  );
}

// ─ 항목(행) 추가·수정 모달 — 대분류·분류·항목 + (추가 시) 기간 ─
function RowFormModal({ groups, cats, row, weeks, defMonth, onSave, onDelete, onDuplicate }: { groups: string[]; cats: string[]; row?: PlanRow; weeks: number[][]; defMonth: number; onSave: (r: { group: string; cat: string; item: string; split: boolean }, bar: Bar | null) => void; onDelete?: () => void; onDuplicate?: () => void }) {
  const { closeModal } = useStore();
  const [group, setGroup] = useState(row?.group || "");
  const [cat, setCat] = useState(row?.cat || "");
  const [item, setItem] = useState(row?.item || "");
  const [split, setSplit] = useState(!!row?.split);
  // 항목을 새로 추가할 때만 기간을 같이 지정(수정 시엔 일정 막대를 따로 편집).
  const adding = !row;
  const [withPeriod, setWithPeriod] = useState(adding);
  const [sm, setSm] = useState(defMonth);
  const [sw, setSw] = useState(1);
  const [em, setEm] = useState(defMonth);
  const [ew, setEw] = useState(1);
  const wkOpts = (m: number) => weeks[m].map((day, i) => ({ v: i + 1, label: `${i + 1}주차 (${day}일~)` }));
  const ok = cat.trim() && item.trim();
  function save() {
    if (!ok) return;
    let bar: Bar | null = null;
    if (adding && withPeriod) {
      const S = { m: sm, w: Math.min(sw, weeks[sm].length) };
      let E = { m: em, w: Math.min(ew, weeks[em].length) };
      if (E.m < S.m || (E.m === S.m && E.w < S.w)) E = { ...S };
      bar = { n: item.trim(), d: "", sm: S.m, sw: S.w, em: E.m, ew: E.w };
    }
    onSave({ group: group.trim(), cat: cat.trim(), item: item.trim(), split }, bar);
    closeModal();
  }
  return (
    <>
      <div className="modal-head">
        <div className="modal-title">{row ? "항목 수정" : "항목 추가"}</div>
        <button className="modal-x" onClick={closeModal} aria-label="닫기"><Icon name="x" /></button>
      </div>
      <div className="modal-body">
        <label className="plan-flabel">대분류 <span className="plan-flabel-opt">선택 · 반/과정 (예: 초등·중고등·고백클래스)</span></label>
        <input className="input" list="plan-groups" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="비우면 '미분류'로 묶여요" autoFocus />
        <datalist id="plan-groups">{groups.filter(Boolean).map((g) => <option key={g} value={g} />)}</datalist>
        <label className="plan-flabel" style={{ marginTop: 14 }}>분류</label>
        <input className="input" list="plan-cats" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="예: 시험대비" />
        <datalist id="plan-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        <label className="plan-flabel" style={{ marginTop: 14 }}>항목 이름</label>
        <input className="input" value={item} onChange={(e) => setItem(e.target.value)} placeholder="예: 중간고사" />

        <label className="plan-week-toggle" style={{ marginTop: 14 }}><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> 단 나누기 — 대상별로 줄 나눠 표시</label>

        {adding && (
          <>
            <label className="plan-flabel" style={{ marginTop: 14 }}>기간</label>
            <label className="plan-week-toggle"><input type="checkbox" checked={withPeriod} onChange={(e) => setWithPeriod(e.target.checked)} /> 이 항목에 일정(기간)도 같이 추가</label>
            {withPeriod && (
              <div className="plan-period" style={{ marginTop: 10 }}>
                <div className="plan-period-row">
                  <span className="plan-period-tag">시작</span>
                  <select className="input" value={sm} onChange={(e) => { const m = Number(e.target.value); setSm(m); if (sw > weeks[m].length) setSw(weeks[m].length); }}>{MONTHS.map((mn, m) => <option key={m} value={m}>{mn}</option>)}</select>
                  <select className="input" value={sw} onChange={(e) => setSw(Number(e.target.value))}>{wkOpts(sm).map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
                </div>
                <div className="plan-period-row">
                  <span className="plan-period-tag">끝</span>
                  <select className="input" value={em} onChange={(e) => { const m = Number(e.target.value); setEm(m); if (ew > weeks[m].length) setEw(weeks[m].length); }}>{MONTHS.map((mn, m) => <option key={m} value={m}>{mn}</option>)}</select>
                  <select className="input" value={ew} onChange={(e) => setEw(Number(e.target.value))}>{wkOpts(em).map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="modal-foot">
        {onDelete && <button className="btn ghost danger" style={{ marginRight: "auto" }} onClick={() => { onDelete(); closeModal(); }}>삭제</button>}
        {onDuplicate && <button className="btn ghost" onClick={() => { onDuplicate(); closeModal(); }}>복제</button>}
        <button className="btn ghost" onClick={closeModal}>취소</button>
        <button className="btn primary" disabled={!ok} onClick={save}>저장</button>
      </div>
    </>
  );
}

// ─ 대분류 색상 선택 모달 ─
function GroupColorModal({ group, current, onPick }: { group: string; current: string; onPick: (color: string) => void }) {
  const { closeModal } = useStore();
  return (
    <>
      <div className="modal-head">
        <div className="modal-title">색상 — {group || "미분류"}</div>
        <button className="modal-x" onClick={closeModal} aria-label="닫기"><Icon name="x" /></button>
      </div>
      <div className="modal-body">
        <div className="page-desc" style={{ marginBottom: 12 }}>이 대분류의 일정 막대 색이에요.</div>
        <div className="plan-swatches">
          {GROUP_PALETTE.map((c) => (
            <button key={c} type="button" className={"plan-swatch" + (current === c ? " on" : "")} style={{ background: c }} onClick={() => { onPick(c); closeModal(); }} aria-label={c} />
          ))}
          <button type="button" className={"plan-swatch plan-swatch-default" + (!current ? " on" : "")} onClick={() => { onPick(""); closeModal(); }}>기본</button>
        </div>
      </div>
    </>
  );
}

export function LessonPlan() {
  const { user } = useAuth();
  const { openModal } = useStore();
  const canEdit = user?.role === "admin" || user?.role === "math";
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();

  const cfgRef = useRef<Record<string, string>>({});
  const [year, setYear] = useState(nowYear);
  const [bars, setBars] = useState<Record<string, Bar[]>>({});
  const [rows, setRows] = useState<PlanRow[]>(DEFAULT_ROWS);
  const [groupColors, setGroupColors] = useState<Record<string, string>>({});
  const [roster, setRoster] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getConfig()
      .then((c) => {
        cfgRef.current = c;
        const rs = rowsFor(c);
        setRows(rs);
        setBars(barsFor(c, nowYear, rs));
        try { setGroupColors(JSON.parse(c[GROUP_COLORS_KEY] || "{}")); } catch { /* {} */ }
      })
      .catch(() => setBars(normalizeBars(defaultBars(nowYear), DEFAULT_ROWS)))
      .finally(() => setLoaded(true));
  }, [nowYear]);

  // 대상(학생) 선택용 명단 — 이름 목록(가나다순).
  useEffect(() => {
    getRoster().then((list) => setRoster(Array.from(new Set(list.map((s) => s.name).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko")))).catch(() => {});
  }, []);

  // ─ 타임라인 기하: 월별 주차, 전역 주차 오프셋 ─
  const weeks = useMemo(() => MONTHS.map((_, m) => mondays(year, m)), [year]);
  const offsets = useMemo(() => { let acc = 0; return weeks.map((w) => { const o = acc; acc += w.length; return o; }); }, [weeks]);
  const totalWeeks = useMemo(() => weeks.reduce((s, w) => s + w.length, 0), [weeks]);
  const gIndex = (m: number, w: number) => offsets[m] + Math.max(0, Math.min(w, weeks[m].length) - 1); // 0-based 전역 주차
  const nowGi = useMemo(() => {
    if (year !== nowYear) return -1;
    const day = now.getDate();
    const ws = weeks[nowMonth];
    let wi = 0;
    for (let i = 0; i < ws.length; i++) if (ws[i] <= day) wi = i;
    return offsets[nowMonth] + wi;
  }, [year, nowYear, nowMonth, weeks, offsets]);

  // 현재 연도면 이번 주가 보이도록 가로 스크롤.(컬럼 폭 30px과 맞춤)
  useEffect(() => {
    if (!loaded || year !== nowYear || nowGi < 0) return;
    const c = scrollRef.current;
    if (c) c.scrollLeft = Math.max(0, nowGi * 30 - c.clientWidth / 2);
  }, [loaded, year, nowYear, nowGi]);

  function changeYear(delta: number) {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const ny = year + delta;
    setYear(ny);
    setBars(barsFor(cfgRef.current, ny, rows));
  }

  const stamp = () => setSavedAt("저장됨 " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
  function scheduleSaveBars(next: Record<string, Bar[]>) {
    const y = year;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const json = JSON.stringify(next);
      cfgRef.current = { ...cfgRef.current, [barsKey(y)]: json };
      void setConfig({ [barsKey(y)]: json }).then(stamp).catch(() => setSavedAt("저장 실패"));
    }, 700);
  }
  function saveRows(next: PlanRow[], movedBars?: Record<string, Bar[]>) {
    setRows(next);
    const json = JSON.stringify(next);
    const patch: Record<string, string> = { [ROWS_KEY]: json };
    if (movedBars) { setBars(movedBars); patch[barsKey(year)] = JSON.stringify(movedBars); }
    cfgRef.current = { ...cfgRef.current, ...patch };
    void setConfig(patch).then(stamp).catch(() => setSavedAt("저장 실패"));
  }

  // ─ 막대(일정) 편집 — 행 id로 묶음 ─
  function setRowBars(id: string, list: Bar[]) {
    setBars((cur) => {
      const next = { ...cur };
      if (list.length) next[id] = list; else delete next[id];
      scheduleSaveBars(next);
      return next;
    });
  }
  function openAddBar(r: PlanRow) {
    if (!canEdit) return;
    const defM = year === nowYear ? nowMonth : 0;
    openModal(<BarModal weeks={weeks} defMonth={defM} roster={roster} onSave={(b) => setRowBars(r.id, [...(bars[r.id] || []), b])} />);
  }
  function openEditBar(r: PlanRow, idx: number, b: Bar) {
    if (!canEdit) { openModal(<BarModal weeks={weeks} defMonth={b.sm} bar={b} roster={roster} onSave={() => {}} />); return; }
    openModal(
      <BarModal weeks={weeks} defMonth={b.sm} bar={b} roster={roster}
        onSave={(nb) => setRowBars(r.id, (bars[r.id] || []).map((x, i) => (i === idx ? nb : x)))}
        onDelete={() => setRowBars(r.id, (bars[r.id] || []).filter((_, i) => i !== idx))}
      />
    );
  }

  // ─ 행(항목) 편집 ─
  const groupList = Array.from(new Set(rows.map((r) => r.group)));
  const catList = Array.from(new Set(rows.map((r) => r.cat)));
  function openAddRow() {
    const defM = year === nowYear ? nowMonth : 0;
    openModal(<RowFormModal weeks={weeks} defMonth={defM} groups={groupList} cats={catList} onSave={(nr, bar) => {
      const id = newId();
      const next = [...rows, { id, ...nr }];
      if (bar) saveRows(next, { ...bars, [id]: [bar] });
      else saveRows(next);
    }} />);
  }
  function openEditRow(r: PlanRow) {
    if (!canEdit) return;
    const defM = year === nowYear ? nowMonth : 0;
    openModal(<RowFormModal weeks={weeks} defMonth={defM} groups={groupList} cats={catList} row={r}
      onSave={(nr) => saveRows(rows.map((x) => (x.id === r.id ? { ...x, ...nr } : x)))}
      onDelete={() => {
        const next = rows.filter((x) => x.id !== r.id);
        if (bars[r.id]) { const nb = { ...bars }; delete nb[r.id]; saveRows(next, nb); }
        else saveRows(next);
      }}
      onDuplicate={() => duplicateRow(r)}
    />);
  }
  // 복제 — 같은 내용·일정을 바로 아래에 새 항목으로(독립). 대분류만 바꿔 다른 반에 붙이면 됨.
  function duplicateRow(r: PlanRow) {
    const copy = { ...r, id: newId() };
    const idx = rows.findIndex((x) => x.id === r.id);
    const next = rows.slice(); next.splice(idx + 1, 0, copy);
    if (bars[r.id]?.length) saveRows(next, { ...bars, [copy.id]: bars[r.id].map((b) => ({ ...b })) });
    else saveRows(next);
  }
  // 드래그로 행 이동 — 드롭한 행 앞에 끼우고 그 행의 대분류를 따라감.
  function reorderRow(srcId: string, dstId: string) {
    if (srcId === dstId) return;
    const src = rows.find((r) => r.id === srcId), dst = rows.find((r) => r.id === dstId);
    if (!src || !dst) return;
    const without = rows.filter((r) => r.id !== srcId);
    const di = without.findIndex((r) => r.id === dstId);
    without.splice(di, 0, { ...src, group: dst.group });
    saveRows(without);
  }
  // 대분류(그룹) 통째로 순서 이동 — 드래그한 그룹을 드롭한 그룹 앞으로.
  function reorderGroup(src: string, dst: string) {
    if (src === dst) return;
    const order: string[] = [];
    for (const r of rows) if (!order.includes(r.group)) order.push(r.group);
    const without = order.filter((g) => g !== src);
    const di = without.indexOf(dst);
    without.splice(di < 0 ? without.length : di, 0, src);
    const next = without.flatMap((g) => rows.filter((r) => r.group === g)); // 그룹순으로 재배치(그룹 내 순서 유지)
    saveRows(next);
  }
  // 대분류 헤더에 드롭 — 그 대분류 끝으로 이동(빈 대분류로도 옮기기).
  function dropToGroup(srcId: string, group: string) {
    const src = rows.find((r) => r.id === srcId);
    if (!src) return;
    const without = rows.filter((r) => r.id !== srcId);
    let at = without.length;
    for (let i = without.length - 1; i >= 0; i--) if (without[i].group === group) { at = i + 1; break; }
    without.splice(at, 0, { ...src, group });
    saveRows(without);
  }
  // ─ 대분류 색상 ─
  function saveGroupColors(next: Record<string, string>) {
    setGroupColors(next);
    const json = JSON.stringify(next);
    cfgRef.current = { ...cfgRef.current, [GROUP_COLORS_KEY]: json };
    void setConfig({ [GROUP_COLORS_KEY]: json }).then(stamp).catch(() => setSavedAt("저장 실패"));
  }
  function openGroupColor(group: string) {
    openModal(<GroupColorModal group={group} current={groupColors[group] || ""} onPick={(c) => {
      const next = { ...groupColors };
      if (c) next[group] = c; else delete next[group];
      saveGroupColors(next);
    }} />);
  }

  // ─ 표시용 라인(대분류 헤더 + 항목 행) ─
  const groupsOrder: string[] = [];
  for (const r of rows) if (!groupsOrder.includes(r.group)) groupsOrder.push(r.group);
  const catSeen = new Set<string>();
  type Line = { type: "group"; group: string } | { type: "item"; row: PlanRow; catFirst: boolean };
  const lines: Line[] = [];
  for (const g of groupsOrder) {
    lines.push({ type: "group", group: g });
    for (const r of rows.filter((x) => x.group === g)) {
      const ck = g + "||" + r.cat;
      const catFirst = !catSeen.has(ck);
      if (catFirst) catSeen.add(ck);
      lines.push({ type: "item", row: r, catFirst });
    }
  }
  // 단 나누기(split): 대상(t)별로 한 레인씩. 행마다 차지하는 그리드 행 수가 달라 누적 위치 계산.
  function laneGroups(list: Bar[]): [string, { b: Bar; idx: number }[]][] {
    const order: string[] = [];
    const map: Record<string, { b: Bar; idx: number }[]> = {};
    list.forEach((b, idx) => { const key = b.t || "기타"; if (!(key in map)) { map[key] = []; order.push(key); } map[key].push({ b, idx }); });
    return order.map((k) => [k, map[k]] as [string, { b: Bar; idx: number }[]]);
  }
  let cursor = 3;
  const placed = lines.map((ln) => {
    let span = 1; let lanes: [string, { b: Bar; idx: number }[]][] | null = null;
    if (ln.type === "item" && ln.row.split) { lanes = laneGroups(bars[ln.row.id] || []); span = Math.max(1, lanes.length); }
    const start = cursor; cursor += span;
    return { ln, start, span, lanes };
  });
  const endRow = cursor; // 그리드 마지막 행(배타적)

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">수학 연간 수업 계획표</h1>
          <div className="page-desc">일정에 기간(시작~끝)을 정하면 달을 넘어 이어지는 막대로 보여요. {canEdit ? "빈 줄을 누르면 일정 추가, 막대를 누르면 수정돼요." : "수학 강사·원장이 작성한 연간 계획이에요."}</div>
        </div>
        <div className="head-actions plan-head-actions">
          {savedAt && <span className="page-desc">{savedAt}</span>}
          {canEdit && <button className="btn ghost sm" onClick={openAddRow}><Icon name="plus" /> 항목 추가</button>}
          <div className="plan-yearnav">
            <button className="btn ghost sm" onClick={() => changeYear(-1)} aria-label="이전 연도">‹</button>
            <span className="plan-year">{year}년{year === nowYear && <span className="plan-year-now">올해</span>}</span>
            <button className="btn ghost sm" onClick={() => changeYear(1)} aria-label="다음 연도">›</button>
          </div>
        </div>
      </div>

      <div className="card pg-wrap" ref={scrollRef}>
        {!loaded ? (
          <div className="hub-muted" style={{ padding: 20 }}>불러오는 중…</div>
        ) : (
          <div className="pg-grid" style={{ gridTemplateColumns: `var(--pg-label-w) repeat(${totalWeeks}, var(--pg-wk-w))` }}>
            {/* 좌상단 모서리 */}
            <div className="pg-corner" style={{ gridRow: "1 / 3", gridColumn: 1 }}>항목</div>
            {/* 월 헤더 */}
            {MONTHS.map((mn, m) => {
              const start = 2 + offsets[m];
              return <div key={m} className={"pg-month" + (m % 3 === 0 ? " qstart" : "")} style={{ gridRow: 1, gridColumn: `${start} / ${start + weeks[m].length}` }}>{mn}</div>;
            })}
            {/* 주차(월요일 날짜) 헤더 */}
            {weeks.map((ws, m) => ws.map((day, wi) => {
              const gi = offsets[m] + wi;
              const isNow = year === nowYear && gi === nowGi;
              return <div key={`${m}-${wi}`} className={"pg-week" + (wi === 0 ? (m % 3 === 0 ? " qstart" : " mstart") : "") + (isNow ? " now" : "")} style={{ gridRow: 2, gridColumn: 2 + gi }}>{day}</div>;
            }))}
            {/* 이번 주 세로 강조 */}
            {year === nowYear && nowGi >= 0 && (
              <div className="pg-nowcol" style={{ gridRow: `3 / ${endRow}`, gridColumn: 2 + nowGi }} aria-hidden />
            )}
            {/* 세로 격자 — 주/월/분기 구분선(주차 헤더~본문) */}
            {weeks.map((ws, m) => ws.map((_, wi) => {
              const gi = offsets[m] + wi;
              const cls = wi === 0 ? (m % 3 === 0 ? " q" : " m") : "";
              return <div key={`v${m}-${wi}`} className={"pg-vline" + cls} style={{ gridRow: `2 / ${endRow}`, gridColumn: 2 + gi }} aria-hidden />;
            }))}
            {/* 라인 */}
            {placed.map((p, i) => {
              const ln = p.ln;
              if (ln.type === "group") {
                const gkey = "g:" + ln.group;
                return (
                  <Fragment key={"g" + i}>
                    <div
                      className={"pg-glabel" + (canEdit ? " draggable" : "") + (overId === gkey ? " dragover" : "") + (dragGroup === ln.group ? " dragging" : "")}
                      style={{ gridRow: p.start, gridColumn: 1 }}
                      draggable={canEdit}
                      onDragStart={canEdit ? (e) => { setDragGroup(ln.group); setDragId(null); e.dataTransfer.effectAllowed = "move"; } : undefined}
                      onDragEnd={canEdit ? () => { setDragGroup(null); setOverId(null); } : undefined}
                      onDragOver={canEdit ? (e) => { e.preventDefault(); setOverId(gkey); } : undefined}
                      onDragLeave={canEdit ? () => setOverId((o) => (o === gkey ? null : o)) : undefined}
                      onDrop={canEdit ? (e) => { e.preventDefault(); if (dragGroup !== null) reorderGroup(dragGroup, ln.group); else if (dragId) dropToGroup(dragId, ln.group); setDragId(null); setDragGroup(null); setOverId(null); } : undefined}
                      title={canEdit ? "드래그로 대분류 순서 이동" : undefined}
                    >
                      <span className="pg-gname">{ln.group || "미분류"}</span>
                      {canEdit && <button type="button" className="pg-swatch-btn" style={{ background: groupColors[ln.group] || DEFAULT_BAR_COLOR }} onClick={(e) => { e.stopPropagation(); openGroupColor(ln.group); }} title="색상 바꾸기" aria-label="색상 바꾸기" />}
                    </div>
                    <div className="pg-gband" style={{ gridRow: p.start, gridColumn: "2 / -1" }} />
                  </Fragment>
                );
              }
              const r = ln.row;
              const color = groupColors[r.group] || DEFAULT_BAR_COLOR;
              const list = bars[r.id] || [];
              // 레인 구성: 단 나누기면 대상별 여러 줄, 아니면 한 줄에 전부.
              const laneRows = p.lanes && p.lanes.length
                ? p.lanes.map((lane, li) => ({ rowAt: p.start + li, first: li === 0, tag: lane[0] as string | null, items: lane[1] }))
                : [{ rowAt: p.start, first: true, tag: null as string | null, items: list.map((b, idx) => ({ b, idx })) }];
              const renderBar = (b: Bar, idx: number, rowAt: number) => {
                const cs = 2 + gIndex(b.sm, b.sw);
                const ce = Math.max(cs + 1, 2 + gIndex(b.em, b.ew) + 1);
                const single = b.sm === b.em && b.sw === b.ew;
                const tg = b.t ? ` (${b.t})` : "";
                return (
                  <button key={r.id + "-" + idx} type="button" className={"pg-bar" + (b.done ? " done" : "") + (single ? " single" : "")} style={{ gridRow: rowAt, gridColumn: `${cs} / ${ce}`, background: b.done ? undefined : color }}
                    onClick={(e) => { e.stopPropagation(); openEditBar(r, idx, b); }}
                    title={(single ? "한 주 일정 · " : "") + (b.t ? `[${b.t}] ` : "") + (b.d ? `${b.n}\n${b.d}` : b.n)}>
                    <span className="pg-bar-name">{b.done ? "✓ " : single ? "• " : ""}{b.n}{tg}</span>
                    {b.d && <span className="pg-bar-dot" aria-label="상세설명 있음" />}
                  </button>
                );
              };
              return (
                <Fragment key={"r" + i}>
                  {laneRows.map((lr, li) => (
                    <Fragment key={"lane" + li}>
                      <div
                        className={"pg-rlabel" + (canEdit ? " editable" : "") + (overId === r.id ? " dragover" : "") + (dragId === r.id ? " dragging" : "") + (lr.first ? "" : " sub")}
                        style={{ gridRow: lr.rowAt, gridColumn: 1 }}
                        draggable={canEdit && lr.first}
                        onDragStart={canEdit && lr.first ? (e) => { setDragId(r.id); setDragGroup(null); e.dataTransfer.effectAllowed = "move"; } : undefined}
                        onDragEnd={canEdit ? () => { setDragId(null); setDragGroup(null); setOverId(null); } : undefined}
                        onDragOver={canEdit ? (e) => { e.preventDefault(); setOverId(r.id); } : undefined}
                        onDragLeave={canEdit ? () => setOverId((o) => (o === r.id ? null : o)) : undefined}
                        onDrop={canEdit ? (e) => { e.preventDefault(); if (dragId) reorderRow(dragId, r.id); setDragId(null); setDragGroup(null); setOverId(null); } : undefined}
                        onClick={() => openEditRow(r)}
                        role={canEdit ? "button" : undefined}
                        title={canEdit ? "드래그로 이동 · 눌러서 분류·이름·단나누기 수정" : undefined}
                      >
                        {lr.first && ln.catFirst && <span className="pg-cat">{r.cat}</span>}
                        {lr.first && <span className="pg-item">{r.item}</span>}
                        {lr.tag && <span className="pg-lane-tag">{lr.tag}</span>}
                      </div>
                      <div className="pg-track" style={{ gridRow: lr.rowAt, gridColumn: "2 / -1" }} onClick={() => openAddBar(r)} title={canEdit ? "눌러서 일정 추가" : undefined} />
                      {lr.items.map(({ b, idx }) => renderBar(b, idx, lr.rowAt))}
                    </Fragment>
                  ))}
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
