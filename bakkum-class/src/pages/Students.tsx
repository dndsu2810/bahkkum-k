import { useStore } from "../store";
import { StudentTable } from "../components/StudentTable";
import { StudentModal } from "../components/modals";
import { Icon } from "../icons";

export function Students() {
  const { data, openModal } = useStore();
  const sorted = data.students
    .slice()
    .sort((a, b) => (a.grade === b.grade ? (a.name < b.name ? -1 : 1) : a.grade === "초등" ? -1 : 1));

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <div className="page-title">학생 관리</div>
          <div className="page-desc">전체 {data.students.length}명 · 등록일 기준 재적 판정</div>
        </div>
        <div className="head-actions">
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
          />
        </div>
      </div>
    </section>
  );
}
