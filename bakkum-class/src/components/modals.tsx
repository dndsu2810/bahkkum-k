import { useState } from "react";
import type { Lesson, Makeup, ScheduleVersion, StudentStatus, TestLog } from "../types";
import { useStore } from "../store";
import { createStudent, hideStudent, pushTestNotion } from "../api";
import { DOW_ORDER, fmtMDDow, todayStr, uid } from "../lib/dates";
import { activeStudents, studentById } from "../lib/logic";
import { GRADE_OPTIONS } from "../lib/grade";
import { Icon } from "../icons";

// 수학 테스트 평가 종류(선택). 첫 항목이 기본값.
export const TEST_TYPES = ["주간test", "KTC수학경시대회"];

function StudentSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useStore();
  const list = activeStudents(data.students).slice().sort((a, b) => (a.name < b.name ? -1 : 1));
  return (
    <div className="select-wrap" style={{ width: "100%" }}>
      <select className="input" style={{ appearance: "none" }} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">학생 선택</option>
        {list.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.grade})
          </option>
        ))}
      </select>
      <Icon name="chev" />
    </div>
  );
}

/* ---------------- Student add / edit ---------------- */
export function StudentModal({ id }: { id: string | null }) {
  const { data, mutate, toast, closeModal } = useStore();
  const existing = id ? studentById(data.students, id) : null;

  const [name, setName] = useState(existing?.name ?? "");
  const [grade, setGrade] = useState<string>(existing?.grade ?? "초1");
  const [status, setStatus] = useState<StudentStatus>(existing?.status ?? "재원");
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayStr());
  const [school, setSchool] = useState(existing?.school ?? "");
  const [birthdate, setBirthdate] = useState(existing?.birthdate ?? "");
  const [parentPhone, setParentPhone] = useState(existing?.parentPhone ?? "");
  const [studentPhone, setStudentPhone] = useState(existing?.studentPhone ?? "");
  const [excluded, setExcluded] = useState(existing?.excluded ?? false);
  const [slots, setSlots] = useState<Lesson[]>(() => {
    if (!existing) return [{ day: "월", time: "16:00", duration: 70 }];
    if (existing.lessons.length) return existing.lessons.map((l) => ({ ...l }));
    // s.lessons가 비었으면 스케줄의 최신 '비어있지 않은' 버전에서 불러온다(꼬인 빈 버전 대비).
    const v = (existing.schedule || []).filter((x) => x.lessons.length).sort((a, b) => (a.from < b.from ? 1 : -1))[0];
    return v ? v.lessons.map((l) => ({ ...l })) : [];
  });
  // 시간표를 바꿀 때 새 시간표가 적용될 시작일 (기존 학생 수정 시에만 사용)
  const [effFrom, setEffFrom] = useState(todayStr());

  function updateSlot(i: number, key: keyof Lesson, value: string) {
    setSlots((cur) =>
      cur.map((s, idx) =>
        idx === i ? { ...s, [key]: key === "duration" ? +value : value } : s
      )
    );
  }
  function removeSlot(i: number) {
    if (slots.length <= 1) {
      toast("수업 시간은 최소 1개 필요해요.");
      return;
    }
    setSlots((cur) => cur.filter((_, idx) => idx !== i));
  }

  async function save() {
    const nm = name.trim();
    if (!nm) {
      toast("이름을 입력해 주세요.");
      return;
    }
    if (!startDate) {
      toast("등록일을 선택해 주세요.");
      return;
    }
    const lessons = slots.map((s) => ({ day: s.day, time: s.time, duration: +s.duration || 0 }));
    const baseFields = {
      name: nm,
      grade,
      status,
      startDate,
      school: school.trim(),
      birthdate,
      parentPhone: parentPhone.trim(),
      studentPhone: studentPhone.trim(),
      excluded,
    };
    if (id) {
      let scheduleChanged = false;
      mutate((d) => {
        const s = studentById(d.students, id);
        if (!s) return;
        Object.assign(s, baseFields);
        // 수정한 핵심 필드를 '앱 소유'로 표시 → 저장 시 반영되고, 노션/다른 저장이 덮어쓰지 않음.
        s.appEdited = [...new Set([...(s.appEdited || []), "name", "grade", "status", "school", "birthdate", "parentPhone", "studentPhone", "startDate"])];
        // 이전 버전 이력 (스케줄 없으면 등록일 기준 단일, 그것도 없으면 빈 이력)
        const prev: ScheduleVersion[] =
          s.schedule && s.schedule.length
            ? s.schedule.map((v) => ({ from: v.from, lessons: v.lessons.map((l) => ({ ...l })) }))
            : s.lessons && s.lessons.length
              ? [{ from: s.startDate || "2000-01-01", lessons: s.lessons.map((l) => ({ ...l })) }]
              : [];
        const prevLatest = prev.length ? prev.reduce((a, b) => (b.from > a.from ? b : a)).lessons : [];
        // 이번 시간표는 effFrom부터 적용 — effFrom 이후(>=) 버전은 이번 것으로 대체, 그 이전(이력)은 유지.
        // (예전엔 effFrom보다 미래의 빈 버전이 남아 실제 시간표를 가리는 버그가 있었음)
        const past = prev.filter((v) => v.from < effFrom);
        const hist = lessons.length ? [...past, { from: effFrom, lessons }] : past;
        hist.sort((a, b) => (a.from < b.from ? -1 : 1));
        scheduleChanged = JSON.stringify(prevLatest) !== JSON.stringify(lessons);
        s.schedule = hist;
        s.lessons = hist.length ? hist.reduce((a, b) => (b.from > a.from ? b : a)).lessons : [];
      });
      closeModal();
      toast(scheduleChanged ? `학생 정보 저장 · 새 시간표는 ${effFrom}부터 적용돼요.` : "학생 정보를 저장했어요.");
    } else {
      // 신규: 등록일부터 적용되는 단일 버전으로 시작
      const schedule: ScheduleVersion[] = [{ from: startDate, lessons }];
      const fields = { ...baseFields, lessons, schedule };
      // roster id is allocated by the shared `students` table (links by name if it exists)
      const { id: newId } = await createStudent(fields);
      mutate((d) => {
        d.students.push({ id: newId, ...fields, appEdited: ["name", "grade", "status", "school", "birthdate", "parentPhone", "studentPhone", "startDate"] });
      });
      closeModal();
      toast("학생을 추가했어요.");
    }
  }

  // 퇴원: status만 바꿔 활성 화면(대시보드/출결/시간표)에서 숨김. 학생관리엔 남음.
  function retire() {
    if (!id) return;
    mutate((d) => {
      const s = studentById(d.students, id);
      if (s) { s.status = "퇴원"; s.appEdited = [...new Set([...(s.appEdited || []), "status"])]; }
    });
    closeModal();
    toast("퇴원 처리했어요.");
  }

  // 삭제: 앱 명단에서 완전히 제거(숨김). 노션/모각공은 건드리지 않음.
  function remove() {
    if (!id) return;
    if (!confirm("이 학생을 앱 명단에서 삭제할까요?\n(노션에는 그대로 남고, 앱에서만 사라집니다)")) return;
    hideStudent(id);
    mutate((d) => {
      d.students = d.students.filter((x) => x.id !== id);
      d.makeups = d.makeups.filter((k) => k.studentId !== id);
      d.homeworkLog = d.homeworkLog.filter((h) => h.studentId !== id);
      d.progressLog = d.progressLog.filter((pr) => pr.studentId !== id);
      Object.keys(d.attendance).forEach((key) => {
        if (key.split("|")[1] === id) delete d.attendance[key];
      });
    });
    closeModal();
    toast("학생을 삭제했어요.");
  }

  return (
    <>
      <div className="modal-head">
        <div className="modal-title">{existing ? "학생 정보 수정" : "학생 추가"}</div>
        <button className="modal-x" onClick={closeModal}>
          <Icon name="x" />
        </button>
      </div>
      <div className="modal-body">
        <div className="field-row">
          <div className="field">
            <label>이름</label>
            <input
              className="input"
              placeholder="학생 이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label>학년</label>
            <div className="select-wrap" style={{ width: "100%" }}>
              <select className="input" style={{ appearance: "none" }} value={grade} onChange={(e) => setGrade(e.target.value)}>
                {GRADE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                {grade && !GRADE_OPTIONS.includes(grade) && <option value={grade}>{grade}</option>}
              </select>
              <Icon name="chev" />
            </div>
          </div>
        </div>
        <div className="field">
          <label>상태</label>
          <div className="seg">
            {(["재원", "휴원", "퇴원", "대기"] as const).map((st) => (
              <button
                key={st}
                type="button"
                className={"seg-btn" + (status === st ? " on" : "")}
                onClick={() => setStatus(st)}
              >
                {st}
              </button>
            ))}
          </div>
          <div className="hint">대시보드·출결·시간표에는 '재원' 학생만 표시됩니다.</div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>등록일</label>
            <input
              className="input"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <div className="hint">월 1일 이전(포함) 등록 시 그 달부터 재적.</div>
          </div>
          <div className="field">
            <label>생년월일</label>
            <input
              className="input"
              type="date"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label>학교</label>
          <input
            className="input"
            placeholder="예: 바꿈초등학교"
            value={school}
            onChange={(e) => setSchool(e.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label>학부모 연락처</label>
            <input
              className="input"
              type="tel"
              placeholder="010-0000-0000"
              value={parentPhone}
              onChange={(e) => setParentPhone(e.target.value)}
            />
          </div>
          <div className="field">
            <label>학생 연락처</label>
            <input
              className="input"
              type="tel"
              placeholder="010-0000-0000"
              value={studentPhone}
              onChange={(e) => setStudentPhone(e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label>수업 스케줄</label>
          <div className="slot-head">
            <span>요일</span>
            <span>시작 시간</span>
            <span>분량(분)</span>
            <span />
          </div>
          <div className="slots">
            {slots.map((sl, idx) => (
              <div className="slot" key={idx}>
                <select value={sl.day} onChange={(e) => updateSlot(idx, "day", e.target.value)}>
                  {DOW_ORDER.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
                <input
                  type="time"
                  value={sl.time}
                  onChange={(e) => updateSlot(idx, "time", e.target.value)}
                />
                <input
                  type="number"
                  min={10}
                  step={10}
                  value={sl.duration}
                  onChange={(e) => updateSlot(idx, "duration", e.target.value)}
                />
                <button type="button" className="slot-x" onClick={() => removeSlot(idx)}>
                  <Icon name="x" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="add-slot"
            onClick={() => setSlots((c) => [...c, { day: "월", time: "16:00", duration: 70 }])}
          >
            <Icon name="plus" />
            수업 시간 추가
          </button>
          <div className="hint">
            초등 주2회 70분 · 주3회 90분 / 중등 주2회 150분 · 주3회 120·120·60분 (가이드)
          </div>
          {existing && (
            <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
              <label>시간표 적용 시작일</label>
              <input
                className="input"
                type="date"
                value={effFrom}
                onChange={(e) => setEffFrom(e.target.value)}
                style={{ width: "auto" }}
              />
              <div className="hint">
                시간표를 바꾸면 이 날짜부터 새 시간표로 출결에 표시되고, 이전 날짜는 기존 시간표가 그대로
                유지됩니다. (시간표를 안 바꾸면 무시돼요.)
              </div>
              {existing.schedule && existing.schedule.length > 1 && (
                <div className="hint" style={{ marginTop: 6 }}>
                  변경 이력:{" "}
                  {existing.schedule
                    .slice()
                    .sort((a, b) => (a.from < b.from ? -1 : 1))
                    .map((v) => `${v.from}~ (주${v.lessons.length}회)`)
                    .join(" → ")}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>인센티브 카운트</label>
          <label className="check">
            <input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} />
            <span>
              <span className="ctxt">인센티브 인원에서 카운트 제외</span>
              <span className="csub">
                인센티브 인원 계산에 넣지 않을 학생. 명단·출결·리포트엔 그대로 표시되고,
                대시보드 인센티브 인원에서만 빠집니다.
              </span>
            </span>
          </label>
        </div>
      </div>
      <div className="modal-foot">
        {existing && existing.status !== "퇴원" && (
          <button className="btn ghost" onClick={retire}>
            <Icon name="ban" />
            퇴원 처리
          </button>
        )}
        {existing && (
          <button className="btn danger" onClick={remove}>
            <Icon name="trash" />
            삭제
          </button>
        )}
        <button className="btn ghost" onClick={closeModal}>
          취소
        </button>
        <button className="btn primary" onClick={save}>
          <Icon name="check" />
          저장
        </button>
      </div>
    </>
  );
}

/* ---------------- Makeup add (absence / makeup) ---------------- */
export function MakeupModal() {
  const { data, mutate, toast, closeModal } = useStore();
  const sorted = data.students.slice().sort((a, b) => (a.name < b.name ? -1 : 1));
  const [studentId, setStudentId] = useState(sorted[0]?.id ?? "");
  const [absentDate, setAbsentDate] = useState(todayStr());
  const [dur, setDur] = useState(70);
  const [memo, setMemo] = useState("");
  const [mkDate, setMkDate] = useState("");
  const [mkTime, setMkTime] = useState("16:00");

  function save() {
    if (!absentDate) {
      toast("결석 날짜를 선택해 주세요.");
      return;
    }
    const k: Makeup = {
      id: uid(),
      studentId,
      absentDate,
      absentTime: "",
      absentDuration: dur,
      attKey: "",
      status: mkDate ? "scheduled" : "pending",
      makeupDate: mkDate || "",
      makeupTime: mkDate ? mkTime : "",
      makeupDuration: dur,
      parentContacted: false,
      memo: memo.trim(),
      createdAt: Date.now(),
    };
    mutate((d) => {
      d.makeups.push(k);
    });
    closeModal();
    toast(mkDate ? "보강을 추가했어요." : "보강 대기에 추가했어요.");
  }

  return (
    <>
      <div className="modal-head">
        <div className="modal-title">결석 / 보강 추가</div>
        <button className="modal-x" onClick={closeModal}>
          <Icon name="x" />
        </button>
      </div>
      <div className="modal-body">
        <div className="field">
          <label>학생</label>
          <div className="select-wrap" style={{ width: "100%" }}>
            <select
              className="input"
              style={{ appearance: "none" }}
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
            >
              {sorted.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.grade})
                </option>
              ))}
            </select>
            <Icon name="chev" />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>결석 날짜</label>
            <input
              className="input"
              type="date"
              value={absentDate}
              onChange={(e) => setAbsentDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label>분량(분)</label>
            <input
              className="input"
              type="number"
              min={10}
              step={10}
              value={dur}
              onChange={(e) => setDur(+e.target.value || 0)}
            />
          </div>
        </div>
        <div className="field">
          <label>메모</label>
          <input
            className="input"
            placeholder="결석 사유 등 (선택)"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>보강 일정 (선택)</label>
          <div className="field-row" style={{ marginBottom: 0 }}>
            <input
              className="input"
              type="date"
              value={mkDate}
              onChange={(e) => setMkDate(e.target.value)}
            />
            <input
              className="input"
              type="time"
              value={mkTime}
              onChange={(e) => setMkTime(e.target.value)}
            />
          </div>
          <div className="hint">날짜를 비워두면 '보강 대기'로 저장됩니다. 나중에 일정을 잡을 수 있어요.</div>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={closeModal}>
          취소
        </button>
        <button className="btn primary" onClick={save}>
          <Icon name="check" />
          저장
        </button>
      </div>
    </>
  );
}

/* ---------------- Schedule a makeup ---------------- */
export function ScheduleModal({ id }: { id: string }) {
  const { data, mutate, toast, closeModal } = useStore();
  const k = data.makeups.find((m) => m.id === id);
  const s = k ? studentById(data.students, k.studentId) : null;
  const name = s ? s.name : "학생";

  const [date, setDate] = useState(k?.makeupDate || todayStr());
  const [time, setTime] = useState(k?.makeupTime || "16:00");
  const [dur, setDur] = useState(k?.makeupDuration || k?.absentDuration || 70);
  const [memo, setMemo] = useState(k?.memo || "");
  if (!k) return null;

  function save() {
    if (!date) {
      toast("보강 날짜를 선택해 주세요.");
      return;
    }
    mutate((d) => {
      const m = d.makeups.find((x) => x.id === id);
      if (m) {
        m.status = "scheduled";
        m.makeupDate = date;
        m.makeupTime = time;
        m.makeupDuration = +dur || 0;
        m.memo = memo.trim();
        // 보강이 실제로 잡히면, 자동 생성된 '보강 일정 잡기' 카드는 완료 처리.
        const card = (d.tasks || []).find((t) => t.source === "absence:" + m.attKey && t.status !== "done");
        if (card) { card.status = "done"; card.doneAt = Date.now(); }
      }
    });
    closeModal();
    toast("보강 일정을 확정했어요.");
  }

  return (
    <>
      <div className="modal-head">
        <div className="modal-title">보강 일정 잡기</div>
        <button className="modal-x" onClick={closeModal}>
          <Icon name="x" />
        </button>
      </div>
      <div className="modal-body">
        <div className="field">
          <label>대상</label>
          <input
            className="input"
            value={name + " · 결석 " + fmtMDDow(k.absentDate)}
            disabled
            style={{ color: "var(--text2)", background: "var(--card2)" }}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label>보강 날짜</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>보강 시간</label>
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>분량(분)</label>
          <input
            className="input"
            type="number"
            min={10}
            step={10}
            value={dur}
            onChange={(e) => setDur(+e.target.value || 0)}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>메모</label>
          <input className="input" value={memo} placeholder="선택" onChange={(e) => setMemo(e.target.value)} />
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={closeModal}>
          취소
        </button>
        <button className="btn primary" onClick={save}>
          <Icon name="check" />
          보강 확정
        </button>
      </div>
    </>
  );
}

/* ---------------- Skip a makeup ---------------- */
export function SkipModal({ id }: { id: string }) {
  const { data, mutate, toast, closeModal } = useStore();
  const k = data.makeups.find((m) => m.id === id);
  const s = k ? studentById(data.students, k.studentId) : null;
  const name = s ? s.name : "학생";
  const [memo, setMemo] = useState(k?.memo || "");
  const [contacted, setContacted] = useState(k?.parentContacted || false);
  if (!k) return null;

  function save() {
    mutate((d) => {
      const m = d.makeups.find((x) => x.id === id);
      if (m) {
        m.status = "skip";
        m.makeupDate = "";
        m.makeupTime = "";
        m.parentContacted = contacted;
        m.memo = memo.trim();
      }
    });
    closeModal();
    toast("보강 미진행으로 저장했어요.");
  }

  return (
    <>
      <div className="modal-head">
        <div className="modal-title">보강 미진행 처리</div>
        <button className="modal-x" onClick={closeModal}>
          <Icon name="x" />
        </button>
      </div>
      <div className="modal-body">
        <div className="field">
          <label>대상</label>
          <input
            className="input"
            value={name + " · 결석 " + fmtMDDow(k.absentDate)}
            disabled
            style={{ color: "var(--text2)", background: "var(--card2)" }}
          />
        </div>
        <div className="field">
          <label>사유 / 메모</label>
          <input
            className="input"
            value={memo}
            placeholder="예: 학부모 협의 후 자습 대체"
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>부모님 연락</label>
          <label className="check">
            <input type="checkbox" checked={contacted} onChange={(e) => setContacted(e.target.checked)} />
            <span>
              <span className="ctxt">부모님과 연락 완료</span>
              <span className="csub">보강을 진행하지 않는 경우, 부모님 안내가 끝났는지 표시해 두세요.</span>
            </span>
          </label>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={closeModal}>
          취소
        </button>
        <button className="btn primary" onClick={save}>
          <Icon name="check" />
          미진행 저장
        </button>
      </div>
    </>
  );
}

/* ---------------- Test add / edit (테스트 관리) ---------------- */
export function TestModal({ id, presetStudentId }: { id: string | null; presetStudentId?: string }) {
  const { data, mutate, toast, closeModal } = useStore();
  const ex = id ? data.testLog.find((t) => t.id === id) : null;
  // 학생은 직접 선택하게 한다(자동으로 첫 학생을 고르지 않음 — '민서준 디폴트' 방지).
  const [studentId, setStudentId] = useState(ex?.studentId ?? presetStudentId ?? "");
  const [date, setDate] = useState(ex?.date ?? todayStr());
  const [type, setType] = useState(ex?.type ?? TEST_TYPES[0]);
  const [round, setRound] = useState(ex?.round ?? "");
  const [range, setRange] = useState(ex?.range ?? "");
  const [status, setStatus] = useState<TestLog["status"]>(ex?.status ?? "예정");
  const [score, setScore] = useState(ex?.score ?? 0);
  const [memo, setMemo] = useState(ex?.memo ?? "");

  function save() {
    if (!studentId) {
      toast("학생을 선택해 주세요.");
      return;
    }
    const rec: TestLog = {
      id: id || uid(),
      studentId,
      date,
      type: type.trim(),
      round: round.trim(),
      range: range.trim(),
      score: status === "완료" ? +score || 0 : 0,
      status,
      memo: memo.trim(),
    };
    mutate((d) => {
      if (id) {
        const i = d.testLog.findIndex((t) => t.id === id);
        if (i >= 0) d.testLog[i] = rec;
      } else {
        d.testLog.push(rec);
      }
    });
    pushTestNotion(studentId, {
      date: rec.date,
      type: rec.type,
      round: rec.round,
      range: rec.range,
      score: rec.score,
      status: rec.status,
      memo: rec.memo,
    });
    closeModal();
    toast(id ? "테스트 기록을 저장했어요." : "테스트를 기록했어요.");
  }

  return (
    <>
      <div className="modal-head">
        <div className="modal-title">{ex ? "테스트 기록 수정" : "테스트 기록"}</div>
        <button className="modal-x" onClick={closeModal}>
          <Icon name="x" />
        </button>
      </div>
      <div className="modal-body">
        <div className="field-row">
          <div className="field">
            <label>학생</label>
            <StudentSelect value={studentId} onChange={setStudentId} />
          </div>
          <div className="field">
            <label>시험일</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>평가 종류</label>
            <div className="select-wrap" style={{ width: "100%" }}>
              <select className="input" style={{ appearance: "none" }} value={type} onChange={(e) => setType(e.target.value)}>
                {TEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                {type && !TEST_TYPES.includes(type) && <option value={type}>{type}</option>}
              </select>
              <Icon name="chev" />
            </div>
          </div>
          <div className="field">
            <label>회차</label>
            <input className="input" placeholder="예: 6월 2주차" value={round} onChange={(e) => setRound(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>시험 범위</label>
          <input className="input" placeholder="예: 5단원 분수의 덧셈과 뺄셈" value={range} onChange={(e) => setRange(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>상태</label>
            <div className="seg">
              {(["예정", "완료"] as const).map((s) => (
                <button key={s} type="button" className={"seg-btn" + (status === s ? " on" : "")} onClick={() => setStatus(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>점수</label>
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={score}
              disabled={status !== "완료"}
              placeholder={status === "예정" ? "완료 시 입력" : ""}
              onChange={(e) => setScore(+e.target.value || 0)}
            />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>특이사항</label>
          <input className="input" placeholder="선택" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
      </div>
      <div className="modal-foot">
        {ex && (
          <button className="btn danger" onClick={() => { mutate((d) => { d.testLog = d.testLog.filter((t) => t.id !== id); }); closeModal(); toast("테스트 기록을 삭제했어요."); }}>
            <Icon name="trash" />
            삭제
          </button>
        )}
        <button className="btn ghost" onClick={closeModal}>취소</button>
        <button className="btn primary" onClick={save}>
          <Icon name="check" />
          저장
        </button>
      </div>
    </>
  );
}
