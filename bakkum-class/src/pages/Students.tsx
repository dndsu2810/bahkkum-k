import { useEffect, useState } from "react";
import type { Student, StudentStatus } from "../types";
import { useStore } from "../store";
import { syncStudents } from "../api";
import { saveStudentCore } from "../lib/rosterApi";
import { mathBandOf, GRADE_OPTIONS, type MathBand } from "../lib/grade";
import { StudentTable, type EditField } from "../components/StudentTable";
import { StudentProfilePopup } from "../components/StudentProfilePopup";
import { Icon } from "../icons";

function applyField(s: Student, field: EditField, value: string) {
  if (field === "name") s.name = value;
  else if (field === "school") s.school = value;
  else if (field === "grade") s.grade = value;
  else if (field === "status") s.status = value as StudentStatus;
}

export function Students() {
  const { data, mutate, mutateAsync, toast, reload } = useStore();
  const [syncing, setSyncing] = useState(false);
  // 학생관리 팝업 — undefined: 닫힘 · null: 신규 등록 · string: 그 학생 편집(공통 팝업).
  const [profileId, setProfileId] = useState<string | null | undefined>(undefined);

  // 노션 학생 명단만 동기화 (출결·숙제 등 기록은 안 건드림). 노션 페이지 ID로 매칭해
  // 중복 없이 새 학생 추가 + 바뀐 정보만 갱신, 앱에서 수정한 값은 보존.
  // silent=true(자동 진입)면 토스트 없이 조용히 갱신, false(수동 버튼)면 결과 토스트 표시.
  async function onSyncStudents(silent = false) {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await syncStudents();
      if (!r.error) await reload();
      if (!silent) {
        if (r.error) toast("명단 새로고침 실패: " + r.error);
        else toast(`새로 추가 ${r.added}명 / 정보 수정 ${r.updated}명 / 변화 없음 ${r.unchanged}명`);
      }
    } finally {
      setSyncing(false);
    }
  }

  // 화면 진입 시 자동으로 1회 명단 새로고침 — 조용히(토스트 없음).
  useEffect(() => {
    void onSyncStudents(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 보기 필터(구분·상태) + 정렬 — 마지막으로 본 설정을 기억(다음에 열어도 유지).
  type BandF = "all" | MathBand;
  type StatusF = "all" | "재원" | "off"; // off = 휴원·퇴원
  type SortBy = "name" | "reg" | "grade";
  const VIEW_KEY = "math_students_view";
  const savedView = (() => {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}") as { band?: BandF; status?: StatusF; sort?: SortBy }; } catch { return {}; }
  })();
  const [bandFilter, setBandFilter] = useState<BandF>(savedView.band ?? "all");
  const [statusFilter, setStatusFilter] = useState<StatusF>(savedView.status ?? "재원");
  const [sortBy, setSortBy] = useState<SortBy>(savedView.sort ?? "name");
  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ band: bandFilter, status: statusFilter, sort: sortBy })); } catch { /* ignore */ }
  }, [bandFilter, statusFilter, sortBy]);

  const filtered = data.students.filter((s) => {
    if (bandFilter !== "all" && mathBandOf(s.grade) !== bandFilter) return false;
    if (statusFilter === "재원" && s.status !== "재원") return false;
    if (statusFilter === "off" && !(s.status === "휴원" || s.status === "퇴원")) return false;
    return true;
  });
  const gradeRank = (g: string) => { const i = GRADE_OPTIONS.indexOf(g); return i < 0 ? GRADE_OPTIONS.length : i; };
  const sorted = filtered.slice().sort((a, b) =>
    sortBy === "reg"
      ? (a.startDate || "").localeCompare(b.startDate || "") || a.name.localeCompare(b.name, "ko")
      : sortBy === "grade"
        ? gradeRank(a.grade) - gradeRank(b.grade) || a.name.localeCompare(b.name, "ko")
        : a.name.localeCompare(b.name, "ko")
  );

  const BANDS: { key: "all" | MathBand; label: string }[] = [
    { key: "all", label: "전체" },
    { key: "low", label: "초등 저학년" },
    { key: "high", label: "초등 고학년" },
    { key: "mid", label: "중고등" },
  ];
  const STATUSES: { key: "all" | "재원" | "off"; label: string }[] = [
    { key: "재원", label: "재원" },
    { key: "off", label: "휴·퇴원" },
    { key: "all", label: "전체" },
  ];

  // 표 안에서 바로 수정 → 즉시 저장. 수정한 필드는 '앱 소유'로 표시해 노션 동기화가
  // 덮어쓰지 않게 한다(명단=노션 원본 · 앱→노션 안 보냄 규칙 유지).
  async function onPatch(id: string, field: EditField, value: string, orig: string): Promise<boolean> {
    const ok = await mutateAsync((d) => {
      const s = d.students.find((x) => x.id === id);
      if (!s) return;
      applyField(s, field, value);
      s.appEdited = [...new Set([...(s.appEdited || []), field])];
    });
    if (!ok) {
      // 저장 실패 → 화면 값을 원래대로 되돌림(서버엔 반영 안 됨)
      mutate((d) => {
        const s = d.students.find((x) => x.id === id);
        if (s) applyField(s, field, orig);
      });
      toast("저장하지 못했어요 · 잠시 후 다시 시도해 주세요");
      return ok;
    }
    // 공통 학생 명단(students 테이블)에도 같은 값을 반영 — 두 화면을 따로 고치지 않게.
    const base = data.students.find((x) => x.id === id);
    if (base) {
      const s: Student = { ...base };
      applyField(s, field, value);
      void saveStudentCore({
        studentId: id,
        ...(field === "name" ? { name: s.name } : {}),
        grade: s.grade,
        status: s.status,
        school: s.school,
        birthdate: s.birthdate,
        parentPhone: s.parentPhone,
        studentPhone: s.studentPhone,
        startDate: s.startDate,
      }).catch(() => toast("공통 명단 반영은 잠시 후 다시 시도해 주세요"));
    }
    return ok;
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">수학 학생 관리</h1>
          <div className="page-desc">
            보이는 학생 {sorted.length}명 (전체 {data.students.length}명) · 셀을 클릭하면 이름·구분·상태·학교를 바로 수정할 수 있어요
          </div>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={() => void onSyncStudents(false)} disabled={syncing}>
            <span className={syncing ? "spin" : undefined}>
              <Icon name="refresh" />
            </span>
            새로고침
          </button>
          <button className="btn primary" onClick={() => setProfileId(null)}>
            <Icon name="plus" />
            학생 추가
          </button>
        </div>
      </div>
      <div className="stu-filterbar">
        <div className="stu-filtergroup">
          <span className="stu-filterlabel">구분</span>
          <div className="seg">
            {BANDS.map((b) => (
              <button key={b.key} type="button" className={"seg-btn" + (bandFilter === b.key ? " on" : "")} onClick={() => setBandFilter(b.key)}>{b.label}</button>
            ))}
          </div>
        </div>
        <div className="stu-filtergroup">
          <span className="stu-filterlabel">상태</span>
          <div className="seg">
            {STATUSES.map((s) => (
              <button key={s.key} type="button" className={"seg-btn" + (statusFilter === s.key ? " on" : "")} onClick={() => setStatusFilter(s.key)}>{s.label}</button>
            ))}
          </div>
        </div>
        <div className="stu-filtergroup">
          <span className="stu-filterlabel">정렬</span>
          <div className="seg">
            <button type="button" className={"seg-btn" + (sortBy === "name" ? " on" : "")} onClick={() => setSortBy("name")}>이름순</button>
            <button type="button" className={"seg-btn" + (sortBy === "grade" ? " on" : "")} onClick={() => setSortBy("grade")}>학년순</button>
            <button type="button" className={"seg-btn" + (sortBy === "reg" ? " on" : "")} onClick={() => setSortBy("reg")}>등록순</button>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="tbl-wrap">
          {sorted.length ? (
            <StudentTable
              list={sorted}
              withActions
              onEdit={(id) => setProfileId(id)}
              onPatch={onPatch}
            />
          ) : (
            <div className="stu-empty">조건에 맞는 학생이 없어요.</div>
          )}
        </div>
      </div>
      {profileId !== undefined && (
        <StudentProfilePopup id={profileId} onClose={() => setProfileId(undefined)} />
      )}
    </section>
  );
}
