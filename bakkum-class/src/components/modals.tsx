import { useState } from "react";
import type { HwLog, Lesson, Makeup, ProgLog, StudentStatus } from "../types";
import { useStore } from "../store";
import { createStudent, hideStudent, pushHomeworkNotion, pushProgressNotion } from "../api";
import { DOW_ORDER, fmtMDDow, todayStr, uid } from "../lib/dates";
import { activeStudents, studentById } from "../lib/logic";
import { Icon } from "../icons";

function StudentSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data } = useStore();
  const list = activeStudents(data.students).slice().sort((a, b) => (a.name < b.name ? -1 : 1));
  return (
    <div className="select-wrap" style={{ width: "100%" }}>
      <select className="input" style={{ appearance: "none" }} value={value} onChange={(e) => onChange(e.target.value)}>
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
  const [grade, setGrade] = useState<"초등" | "중등">(existing?.grade ?? "초등");
  const [status, setStatus] = useState<StudentStatus>(existing?.status ?? "재원");
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayStr());
  const [school, setSchool] = useState(existing?.school ?? "");
  const [birthdate, setBirthdate] = useState(existing?.birthdate ?? "");
  const [parentPhone, setParentPhone] = useState(existing?.parentPhone ?? "");
  const [studentPhone, setStudentPhone] = useState(existing?.studentPhone ?? "");
  const [excluded, setExcluded] = useState(existing?.excluded ?? false);
  const [slots, setSlots] = useState<Lesson[]>(
    existing
      ? existing.lessons.map((l) => ({ ...l }))
      : [{ day: "월", time: "16:00", duration: 70 }]
  );

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
    const fields = {
      name: nm,
      grade,
      status,
      startDate,
      school: school.trim(),
      birthdate,
      parentPhone: parentPhone.trim(),
      studentPhone: studentPhone.trim(),
      excluded,
      lessons,
    };
    if (id) {
      mutate((d) => {
        const s = studentById(d.students, id);
        if (s) Object.assign(s, fields);
      });
      closeModal();
      toast("학생 정보를 저장했어요.");
    } else {
      // roster id is allocated by the shared `students` table (links by name if it exists)
      const { id: newId } = await createStudent(fields);
      mutate((d) => {
        d.students.push({ id: newId, ...fields });
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
      if (s) s.status = "퇴원";
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
            <label>구분</label>
            <div className="seg">
              {(["초등", "중등"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={"seg-btn" + (grade === g ? " on" : "")}
                  onClick={() => setGrade(g)}
                >
                  {g}
                </button>
              ))}
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
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>원장 메모</label>
          <label className="check">
            <input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} />
            <span>
              <span className="ctxt">정산 특이 학생으로 표시</span>
              <span className="csub">
                원장 본인 확인용 내부 메모입니다. 화면 어디에도 표시되지 않으며 리포트에도 포함되지 않습니다.
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

/* ---------------- Homework add / edit ---------------- */
export function HomeworkModal({ id, presetStudentId }: { id: string | null; presetStudentId?: string }) {
  const { data, mutate, toast, closeModal } = useStore();
  const ex = id ? data.homeworkLog.find((h) => h.id === id) : null;
  const first = activeStudents(data.students)[0];
  const [studentId, setStudentId] = useState(ex?.studentId ?? presetStudentId ?? first?.id ?? "");
  const [date, setDate] = useState(ex?.date ?? todayStr());
  const [book, setBook] = useState(ex?.book ?? "");
  const [tags, setTags] = useState((ex?.tags ?? []).join(", "));
  const [completion, setCompletion] = useState(ex?.completion ?? 0);
  const [status, setStatus] = useState<HwLog["status"]>(ex?.status ?? "pending");
  const [memo, setMemo] = useState(ex?.memo ?? "");

  function save() {
    if (!studentId) {
      toast("학생을 선택해 주세요.");
      return;
    }
    const tagArr = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const rec: HwLog = { id: id || uid(), studentId, date, book: book.trim(), tags: tagArr, completion: +completion || 0, status, memo: memo.trim() };
    mutate((d) => {
      if (id) {
        const i = d.homeworkLog.findIndex((h) => h.id === id);
        if (i >= 0) d.homeworkLog[i] = rec;
      } else {
        d.homeworkLog.push(rec);
      }
    });
    pushHomeworkNotion(studentId, {
      date,
      book: rec.book,
      tags: rec.tags,
      completion: rec.completion,
      done: status === "done",
      memo: rec.memo,
    });
    closeModal();
    toast(id ? "숙제 기록을 저장했어요." : "숙제를 기록했어요.");
  }

  return (
    <>
      <div className="modal-head">
        <div className="modal-title">{ex ? "숙제 기록 수정" : "숙제 기록"}</div>
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
            <label>숙제 마감일</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>교재</label>
          <input className="input" placeholder="예: 디딤돌 개념" value={book} onChange={(e) => setBook(e.target.value)} />
        </div>
        <div className="field">
          <label>태그</label>
          <input className="input" placeholder="쉼표로 구분 (예: 개념, 오답)" value={tags} onChange={(e) => setTags(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>완성도(%)</label>
            <input className="input" type="number" min={0} max={100} value={completion} onChange={(e) => setCompletion(+e.target.value || 0)} />
          </div>
          <div className="field">
            <label>상태</label>
            <div className="seg">
              {(["pending", "done", "late"] as const).map((s) => (
                <button key={s} type="button" className={"seg-btn" + (status === s ? " on" : "")} onClick={() => setStatus(s)}>
                  {s === "pending" ? "검사 전" : s === "done" ? "검사완료" : "지연"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>선생님 메모</label>
          <input className="input" placeholder="선택" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
      </div>
      <div className="modal-foot">
        {ex && (
          <button className="btn danger" onClick={() => { mutate((d) => { d.homeworkLog = d.homeworkLog.filter((h) => h.id !== id); }); closeModal(); toast("숙제 기록을 삭제했어요."); }}>
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

/* ---------------- Progress add / edit ---------------- */
export function ProgressModal({ id, presetStudentId }: { id: string | null; presetStudentId?: string }) {
  const { data, mutate, toast, closeModal } = useStore();
  const ex = id ? data.progressLog.find((p) => p.id === id) : null;
  const first = activeStudents(data.students)[0];
  const [studentId, setStudentId] = useState(ex?.studentId ?? presetStudentId ?? first?.id ?? "");
  const [date, setDate] = useState(ex?.date ?? todayStr());
  const [unit, setUnit] = useState(ex?.unit ?? "");
  const [area, setArea] = useState(ex?.area ?? "");
  const [pct, setPct] = useState(ex?.pct ?? 0);
  const [startDate, setStartDate] = useState(ex?.startDate ?? "");
  const [memo, setMemo] = useState(ex?.memo ?? "");

  function save() {
    if (!studentId) {
      toast("학생을 선택해 주세요.");
      return;
    }
    if (!unit.trim()) {
      toast("단원을 입력해 주세요.");
      return;
    }
    const rec: ProgLog = { id: id || uid(), studentId, date, unit: unit.trim(), area: area.trim(), pct: +pct || 0, startDate, memo: memo.trim() };
    mutate((d) => {
      if (id) {
        const i = d.progressLog.findIndex((p) => p.id === id);
        if (i >= 0) d.progressLog[i] = rec;
      } else {
        d.progressLog.push(rec);
      }
    });
    pushProgressNotion(studentId, { unit: rec.unit, area: rec.area, pct: rec.pct, startDate: rec.startDate, memo: rec.memo });
    closeModal();
    toast(id ? "진도 기록을 저장했어요." : "진도를 기록했어요.");
  }

  return (
    <>
      <div className="modal-head">
        <div className="modal-title">{ex ? "진도 기록 수정" : "진도 기록"}</div>
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
            <label>기록일</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>단원</label>
          <input className="input" placeholder="예: 3단원 소수의 나눗셈" value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label>학습 영역</label>
            <input className="input" placeholder="예: 개념" value={area} onChange={(e) => setArea(e.target.value)} />
          </div>
          <div className="field">
            <label>달성률(%)</label>
            <input className="input" type="number" min={0} max={100} value={pct} onChange={(e) => setPct(+e.target.value || 0)} />
          </div>
        </div>
        <div className="field">
          <label>학습 시작일</label>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>메모</label>
          <input className="input" placeholder="선택" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
      </div>
      <div className="modal-foot">
        {ex && (
          <button className="btn danger" onClick={() => { mutate((d) => { d.progressLog = d.progressLog.filter((p) => p.id !== id); }); closeModal(); toast("진도 기록을 삭제했어요."); }}>
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
