import { useEffect, useRef, useState } from "react";
import { classNoteApi } from "../lib/classNoteApi";

/** 알림장 입력칸(강사용) — 학생·날짜별 메모. 자기 데이터를 직접 불러오고 저장(스냅샷과 무관).
 *  오늘 학생에게 보여줄 안내(준비물·전달사항 등)를 적어요. 오늘 숙제는 학생 화면에서 자동으로 함께 보여요. */
export function ClassNoteBox({ studentId, date }: { studentId: string; date: string }) {
  const [memo, setMemo] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const loadedFor = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const key = studentId + "|" + date;
    loadedFor.current = key;
    classNoteApi.get(studentId, date).then((m) => {
      if (loadedFor.current === key) { setMemo(m); setState("idle"); }
    });
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [studentId, date]);

  function onChange(v: string) {
    setMemo(v);
    setState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { await classNoteApi.save(studentId, date, v); setState("saved"); }
      catch { setState("idle"); }
    }, 700);
  }

  return (
    <div className="cnote">
      <div className="cnote-h">
        <span>알림장</span>
        {state === "saving" && <span className="cnote-state">저장 중…</span>}
        {state === "saved" && <span className="cnote-state ok">저장됨</span>}
      </div>
      <textarea
        className="input cnote-ta"
        rows={2}
        value={memo}
        onChange={(e) => onChange(e.target.value)}
        placeholder="오늘 학생에게 전할 말(준비물·안내 등). 오늘 숙제는 자동으로 함께 보여요."
      />
    </div>
  );
}
