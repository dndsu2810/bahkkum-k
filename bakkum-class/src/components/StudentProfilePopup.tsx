import { useEffect, useState } from "react";
import { useStore } from "../store";
import { getRoster, type RosterStudent } from "../lib/rosterApi";
import { todayStr } from "../lib/dates";
import { ProfileModal } from "../screens/StudentMaster";

/** 수학 화면 '학생관리' — 공통 학생 팝업(ProfileModal)을 그대로 띄운다.
 *  영어·공통 명단과 같은 한 컴포넌트·한 저장경로라 정보가 어긋나거나 충돌하지 않아요.
 *  - id 있음: 기존 학생 편집(공통 로스터에서 불러옴).
 *  - id=null: 새 학생 등록 — 빈 양식으로 열고, 저장(등록) 때 실제로 만들어요(미리 만들지 않아 빈 학생이 남지 않음).
 *    수학 화면에서 연 새 학생은 '수학' 과목이 기본 선택돼요. */
const EMPTY_STUDENT = (): RosterStudent => ({
  id: "",
  name: "",
  grade: "초1",
  status: "재원",
  school: "",
  birthdate: "",
  parentPhone: "",
  studentPhone: "",
  startDate: todayStr(),
  onlineId: "",
  subjects: ["math"],
  englishBand: "",
  mathClass: "",
  attendDays: [],
  memo: "",
  photo: "",
  checkinNo: "",
  mathStart: "",
  engStart: "",
  mathSlots: [],
  engSlots: [],
});

export function StudentProfilePopup({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { reload } = useStore();
  const [student, setStudent] = useState<RosterStudent | null>(id === null ? EMPTY_STUDENT() : null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (id === null) { setStudent(EMPTY_STUDENT()); return; }
    let alive = true;
    getRoster(true)
      .then((roster) => {
        if (!alive) return;
        const found = roster.find((r) => r.id === id) || null;
        if (found) setStudent(found);
        else setErr("학생 정보를 불러오지 못했어요.");
      })
      .catch((e) => { if (alive) setErr(String((e as Error)?.message || e) || "불러오지 못했어요."); });
    return () => { alive = false; };
  }, [id]);

  if (err) {
    return (
      <div className="prof-overlay" onClick={onClose}>
        <div className="prof" onClick={(e) => e.stopPropagation()} style={{ padding: 24, minHeight: 0 }}>
          <p className="sp-muted" style={{ margin: 0 }}>{err}</p>
          <div className="prof-foot"><button className="btn ghost" onClick={onClose}>닫기</button></div>
        </div>
      </div>
    );
  }
  if (!student) {
    return (
      <div className="prof-overlay" onClick={onClose}>
        <div className="prof" onClick={(e) => e.stopPropagation()} style={{ padding: 24, minHeight: 0 }}>불러오는 중…</div>
      </div>
    );
  }
  return (
    <ProfileModal
      student={student}
      canEdit
      isNew={id === null}
      onClose={onClose}
      onSaved={() => { void reload(); }}
    />
  );
}
