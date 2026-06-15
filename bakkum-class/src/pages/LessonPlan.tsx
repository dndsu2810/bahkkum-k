import { Icon } from "../icons";

// 연간 수업 계획표 — 원장이 쓰던 구글시트를 수학 수업관리 안에서 바로 보고 열기.
const SHEET_ID = "1A9jeGcmog9lN2yt_Kt4XcYUnywkP6vjSnIadJvwcEPU";
const SHEET_EDIT = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?usp=sharing`;
const SHEET_PREVIEW = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/preview`;

export function LessonPlan() {
  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">수학 연간 수업 계획표</h1>
          <div className="page-desc">연간 수업 계획을 한 곳에서 보고 편집해요. 편집은 ‘구글시트 열기’로.</div>
        </div>
        <div className="head-actions">
          <a className="btn primary" href={SHEET_EDIT} target="_blank" rel="noopener noreferrer">
            <Icon name="cal" />
            구글시트 열기 ↗
          </a>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <iframe
          title="연간 수업 계획표"
          src={SHEET_PREVIEW}
          className="plan-frame"
          loading="lazy"
        />
      </div>
      <div className="page-desc" style={{ marginTop: 10 }}>
        표가 안 보이면 시트 공유 설정(링크가 있는 모든 사용자 보기)을 확인하거나, 위 ‘구글시트 열기’로 새 탭에서 보세요.
      </div>
    </section>
  );
}
