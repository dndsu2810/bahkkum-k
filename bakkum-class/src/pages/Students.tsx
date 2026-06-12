import { useEffect, useState } from "react";
import type { Student, StudentStatus } from "../types";
import { useStore } from "../store";
import { syncStudents } from "../api";
import { catIndex } from "../lib/categories";
import { StudentTable, type EditField } from "../components/StudentTable";
import { StudentModal } from "../components/modals";
import { Icon } from "../icons";

function applyField(s: Student, field: EditField, value: string) {
  if (field === "name") s.name = value;
  else if (field === "school") s.school = value;
  else if (field === "grade") s.grade = value;
  else if (field === "status") s.status = value as StudentStatus;
}

export function Students() {
  const { data, openModal, mutate, mutateAsync, toast, reload } = useStore();
  const [syncing, setSyncing] = useState(false);

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

  const sorted = data.students
    .slice()
    .sort((a, b) => (a.grade === b.grade ? (a.name < b.name ? -1 : 1) : catIndex(a.grade) - catIndex(b.grade)));

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
    }
    return ok;
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">학생 관리</h1>
          <div className="page-desc">
            전체 {data.students.length}명 · 셀을 클릭하면 이름·구분·상태·학교를 바로 수정할 수 있어요
          </div>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={() => void onSyncStudents(false)} disabled={syncing}>
            <span className={syncing ? "spin" : undefined}>
              <Icon name="refresh" />
            </span>
            새로고침
          </button>
          <button className="btn primary" onClick={() => openModal(<StudentModal id={null} />)}>
            <Icon name="plus" />
            학생 추가
          </button>
        </div>
      </div>
      <div className="card">
        <div className="tbl-wrap">
          <StudentTable
            list={sorted}
            withActions
            onEdit={(id) => openModal(<StudentModal id={id} />)}
            onPatch={onPatch}
          />
        </div>
      </div>
    </section>
  );
}
