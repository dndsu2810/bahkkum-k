// 반복 시험 예약 — 규칙을 팝업으로 편집(이름·요일·주차·단원·대상 학생·반복 마감일).
// 규칙대로 학생별 등원 수/목(또는 고정 요일)에 자동 예약. KTC는 내장(월별 2번째 수/목, 단원 자동).
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { todayStr } from "../lib/dates";
import { activeStudents } from "../lib/logic";
import { mathBandOf } from "../lib/grade";
import { testRuleApi, type TestRule } from "../lib/testRuleApi";
import { planFromRules, testDayOf, KTC_TYPE, WEEKLY_TYPE } from "../lib/ktcSchedule";
import { Icon } from "../icons";
import type { Student } from "../types";

function rid(): string { return "tr_" + Math.random().toString(36).slice(2, 10); }
const blankRule = (): TestRule => ({ id: rid(), name: "", kind: "weekly", studentIds: [], active: true, createdAt: Date.now(), day: "auto", range: "", until: "", wom: "every" });
const DAY_OPTS = [{ v: "auto", l: "등원 수/목 자동" }, { v: "월", l: "월요일" }, { v: "화", l: "화요일" }, { v: "수", l: "수요일" }, { v: "목", l: "목요일" }, { v: "금", l: "금요일" }];
const WOM_OPTS = [{ v: "every", l: "매주" }, { v: "1", l: "매월 1번째 주" }, { v: "2", l: "매월 2번째 주" }, { v: "3", l: "매월 3번째 주" }, { v: "4", l: "매월 4번째 주" }];

export function TestRuleBoard() {
  const { data, mutate, toast } = useStore();
  const students = useMemo(() => activeStudents(data.students).slice().sort((a, b) => a.name.localeCompare(b.name, "ko")), [data.students]);
  const studentsById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const [rules, setRules] = useState<TestRule[] | null>(null);
  const [editing, setEditing] = useState<TestRule | null>(null); // 팝업에서 편집 중인 규칙(복사본)
  const seeded = useRef(false);

  // 규칙 로드 + 처음이면 기본 규칙 시드(주간test=수/목 학생, KTC=초등 고학년).
  useEffect(() => {
    let on = true;
    testRuleApi.list().then(async (rs) => {
      if (!on) return;
      if (rs.length === 0 && !seeded.current && students.length) {
        seeded.current = true;
        const weeklyIds = students.filter((s) => testDayOf(s, todayStr())).map((s) => s.id);
        const ktcIds = students.filter((s) => mathBandOf(s.grade, "") === "high").map((s) => s.id);
        const defs: TestRule[] = [
          { ...blankRule(), name: WEEKLY_TYPE, kind: "weekly", studentIds: weeklyIds },
          { ...blankRule(), id: rid(), name: KTC_TYPE, kind: "ktc", studentIds: ktcIds, createdAt: Date.now() + 1 },
        ];
        for (const r of defs) { try { await testRuleApi.save(r); } catch { /* ignore */ } }
        if (on) setRules(defs);
      } else setRules(rs);
    });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students.length]);

  // 규칙이 준비되면 다가오는 8주 예약을 자동으로 채움(중복 없이).
  const ensured = useRef(false);
  useEffect(() => {
    if (!rules || ensured.current) return;
    ensured.current = true;
    const created = planFromRules(rules, studentsById, data.testLog, 8);
    if (created.length) { mutate((d) => { d.testLog.push(...created); }); toast(`테스트 ${created.length}건 자동 예약했어요`); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules]);

  function fillNow() {
    if (!rules) return;
    const created = planFromRules(rules, studentsById, data.testLog, 8);
    if (created.length) { mutate((d) => { d.testLog.push(...created); }); toast(`테스트 ${created.length}건 예약했어요`); }
    else toast("이미 다 예약돼 있어요");
  }

  async function saveRule(r: TestRule) {
    const name = r.name.trim();
    if (!name) { toast("시험 이름을 입력해주세요"); return; }
    const next = { ...r, name };
    setRules((rs) => { const cur = rs || []; return cur.some((x) => x.id === r.id) ? cur.map((x) => (x.id === r.id ? next : x)) : [...cur, next]; });
    setEditing(null);
    try { await testRuleApi.save(next); } catch { toast("저장하지 못했어요"); }

    // 저장 후: 이 규칙이 만든 '미래·예정' 예약을 새 조건에 맞게 재정렬한다.
    //  요일·주차·대상·마감을 바꾸면 옛 조건으로 만들어진 미래 예약(예: 옛 요일)을 지우고 새 조건으로 다시 채운다.
    //  → 요일만 바꿔 재예약하면 중복이 우르르 생기던 문제 방지. 완료·과거·다른 규칙 예약은 건드리지 않는다.
    const oldRule = (rules || []).find((x) => x.id === r.id);
    const names = new Set([oldRule?.name.trim(), next.name].filter(Boolean) as string[]); // 이름 바꿨어도 옛 이름까지 정리
    const sids = new Set<string>([...(oldRule?.studentIds || []), ...next.studentIds]); // 대상에서 빠진 학생의 옛 예약도 정리
    const today = todayStr();
    const want = next.active ? planFromRules([next], studentsById, [], 8) : []; // 이 규칙이 지금 만들어야 할 미래 예약 전체
    const wantKeys = new Set(want.map((t) => `${t.studentId}|${t.date}|${t.type}`));
    mutate((d) => {
      if (next.active) {
        // 이 규칙에서 나온 미래·예정 예약 중 새 조건에 안 맞는 건 제거(완료·과거·다른 규칙은 보존).
        d.testLog = d.testLog.filter((t) => {
          const fromThisRule = t.status === "예정" && t.date >= today && names.has(t.type) && sids.has(t.studentId);
          return fromThisRule ? wantKeys.has(`${t.studentId}|${t.date}|${t.type}`) : true;
        });
      }
      // 빠진 새 예약만 추가(중복 없이).
      const have = new Set(d.testLog.map((t) => `${t.studentId}|${t.date}|${t.type}`));
      for (const w of want) { const k = `${w.studentId}|${w.date}|${w.type}`; if (!have.has(k)) { have.add(k); d.testLog.push(w); } }
    });
  }
  async function removeRule(r: TestRule) {
    if (!window.confirm(`'${r.name}' 반복 예약을 삭제할까요? (이미 만들어진 예약은 남아요)`)) return;
    setRules((rs) => (rs || []).filter((x) => x.id !== r.id));
    setEditing(null);
    try { await testRuleApi.remove(r.id); } catch { /* ignore */ }
  }
  async function toggleActive(r: TestRule) {
    const next = { ...r, active: !r.active };
    setRules((rs) => (rs || []).map((x) => (x.id === r.id ? next : x)));
    try { await testRuleApi.save(next); } catch { /* ignore */ }
  }

  // 규칙 한 줄 요약(대상·요일·주차·마감).
  function summary(r: TestRule): string {
    if (r.kind === "ktc") return `매월 2번째 수/목 · 단원 자동`;
    const day = DAY_OPTS.find((d) => d.v === (r.day || "auto"))?.l || "등원 수/목";
    const wom = WOM_OPTS.find((w) => w.v === (r.wom || "every"))?.l || "매주";
    const until = r.until ? ` · ~${r.until}` : " · 계속";
    return `${wom} · ${day}${r.range ? ` · ${r.range}` : ""}${until}`;
  }

  return (
    <div className="card sec-gap trule">
      <div className="card-head">
        <div>
          <div className="card-title">반복 시험 예약</div>
          <div className="card-sub">규칙을 만들면 매주 그 학생 등원 수/목(또는 정한 요일)에 자동 예약돼요. KTC는 월별 2번째 주에 단원까지 자동.</div>
        </div>
        <button className="btn ghost sm" onClick={fillNow}><Icon name="refresh" /> 지금 채우기</button>
      </div>

      {!rules ? (
        <div className="trule-empty">불러오는 중…</div>
      ) : (
        <div className="trule-list">
          {rules.map((r) => (
            <div className={"trule-item" + (r.active ? "" : " off")} key={r.id}>
              <span className={"trule-kind" + (r.kind === "ktc" ? " ktc" : "")}>{r.kind === "ktc" ? "KTC" : "주간"}</span>
              <div className="trule-main">
                <div className="trule-name">{r.name}</div>
                <div className="trule-sum">{r.studentIds.length}명 · {summary(r)}</div>
              </div>
              <button className={"btn sm" + (r.active ? " ghost" : " primary")} onClick={() => toggleActive(r)}>{r.active ? "켜짐" : "꺼짐"}</button>
              <button className="btn sm" onClick={() => setEditing({ ...r })}><Icon name="edit" /> 수정</button>
            </div>
          ))}
          <button className="btn ghost sm trule-addbtn" onClick={() => setEditing(blankRule())}><Icon name="plus" /> 반복 예약 추가</button>
        </div>
      )}

      {editing && (
        <RuleEditor
          rule={editing}
          students={students}
          onClose={() => setEditing(null)}
          onSave={saveRule}
          onDelete={rules?.some((x) => x.id === editing.id) ? () => removeRule(editing) : undefined}
        />
      )}
    </div>
  );
}

/* 규칙 편집 팝업 — 이름·요일·주차·단원·대상 학생·반복 마감일. */
function RuleEditor({ rule, students, onClose, onSave, onDelete }: { rule: TestRule; students: Student[]; onClose: () => void; onSave: (r: TestRule) => void; onDelete?: () => void }) {
  const [draft, setDraft] = useState<TestRule>(rule);
  const [q, setQ] = useState("");
  const isKtc = draft.kind === "ktc";
  const set = (patch: Partial<TestRule>) => setDraft((d) => ({ ...d, ...patch }));
  const filtered = useMemo(() => { const k = q.trim(); return k ? students.filter((s) => s.name.includes(k) || (s.grade || "").includes(k)) : students; }, [q, students]);
  const toggle = (id: string) => set({ studentIds: draft.studentIds.includes(id) ? draft.studentIds.filter((x) => x !== id) : [...draft.studentIds, id] });

  return (
    <div className="trule-overlay" onClick={onClose}>
      <div className="trule-modal" onClick={(e) => e.stopPropagation()}>
        <div className="trule-modal-h">
          <h3>{rule.name ? "반복 예약 수정" : "반복 예약 추가"}</h3>
          <button className="trule-x" onClick={onClose} aria-label="닫기"><Icon name="x" /></button>
        </div>

        <div className="trule-form">
          <label className="trule-f">
            <span>시험 이름</span>
            <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 주간test, 단원평가" disabled={isKtc} />
          </label>

          {isKtc ? (
            <div className="trule-note"><Icon name="info" /> KTC는 매월 2번째 수/목에 자동 예약되고 단원도 표대로 자동이에요. 대상 학생만 정하면 돼요.</div>
          ) : (
            <div className="trule-frow">
              <label className="trule-f">
                <span>반복 주차</span>
                <select className="input" value={draft.wom || "every"} onChange={(e) => set({ wom: e.target.value })}>
                  {WOM_OPTS.map((w) => <option key={w.v} value={w.v}>{w.l}</option>)}
                </select>
              </label>
              <label className="trule-f">
                <span>요일</span>
                <select className="input" value={draft.day || "auto"} onChange={(e) => set({ day: e.target.value })}>
                  {DAY_OPTS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
                </select>
              </label>
            </div>
          )}

          {!isKtc && (
            <label className="trule-f">
              <span>단원 미리 입력 <em className="trule-opt">선택 — 비워두면 직접 입력</em></span>
              <input className="input" value={draft.range || ""} onChange={(e) => set({ range: e.target.value })} placeholder="예: 5단원 분수의 덧셈과 뺄셈" />
            </label>
          )}

          <label className="trule-f">
            <span>반복 마감일 <em className="trule-opt">안 정하면 계속</em></span>
            <div className="trule-until">
              <input className="input" type="date" value={draft.until || ""} min={todayStr()} onChange={(e) => set({ until: e.target.value })} />
              {draft.until && <button type="button" className="trule-until-clear" onClick={() => set({ until: "" })}>계속으로</button>}
            </div>
          </label>

          <div className="trule-f">
            <span>대상 학생 <em className="trule-opt">{draft.studentIds.length}명</em></span>
            <input className="input trule-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·학년으로 검색" />
            <div className="trule-picks">
              {filtered.map((s) => {
                const on = draft.studentIds.includes(s.id);
                const noDay = !isKtc && (draft.day || "auto") === "auto" && testDayOf(s, todayStr()) === null;
                return (
                  <button key={s.id} className={"trule-chip" + (on ? " on" : "")} onClick={() => toggle(s.id)} title={noDay ? "수/목 등원이 없어 예약은 안 잡혀요" : ""}>
                    {on && <Icon name="check" />}{s.name}{s.grade ? <span className="trule-chip-g">{s.grade}</span> : null}{noDay && <span className="trule-chip-warn">수목X</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="trule-modal-foot">
          {onDelete ? <button className="btn ghost sm trule-del" onClick={onDelete}><Icon name="trash" /> 삭제</button> : <span />}
          <div className="trule-modal-actions">
            <button className="btn ghost" onClick={onClose}>취소</button>
            <button className="btn primary" onClick={() => onSave(draft)} disabled={!draft.name.trim()}>저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}
