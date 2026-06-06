import type { ReportData } from "../lib/reportTypes";
import { ReportCard } from "../components/ReportCard";
import { Icon } from "../icons";

export function ReportPreview({
  data,
  onBack,
  onSave,
  saving,
}: {
  data: ReportData;
  onBack: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <section className="page active">
      <div className="report-toolbar">
        <button className="btn ghost" onClick={onBack}>
          <Icon name="chev" />
          목록으로
        </button>
        <div style={{ fontWeight: 700 }}>
          {data.studentName} · {data.year}년 {data.month}월 리포트 미리보기
        </div>
        <button className="btn primary" onClick={onSave} disabled={saving}>
          <Icon name="copy" />
          {saving ? "저장 중…" : "이미지 2장 저장"}
        </button>
      </div>
      <div className="report-stage">
        <ReportCard data={data} />
      </div>
    </section>
  );
}
