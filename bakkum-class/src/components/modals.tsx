import { useState } from "react";
import type { Lesson, Makeup, StudentStatus } from "../types";
import { useStore } from "../store";
import { DOW_ORDER, fmtMDDow, todayStr, uid } from "../lib/dates";
import { studentById } from "../lib/logic";
import { Icon } from "../icons";

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

  function save() {
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
    mutate((d) => {
      if (id) {
        const s = studentById(d.students, id);
        if (s) Object.assign(s, fields);
      } else {
        d.students.push({ id: uid(), ...fields });
      }
    });
    closeModal();
    toast(id ? "학생 정보를 저장했어요." : "학생을 추가했어요.");
  }

  function remove() {
    if (!id) return;
    mutate((d) => {
      d.students = d.students.filter((x) => x.id !== id);
      d.makeups = d.makeups.filter((k) => k.studentId !== id);
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
