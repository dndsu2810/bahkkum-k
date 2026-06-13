import { useAuth } from "../auth";
import { dutyLabel } from "../lib/workspace";

/** 허브 홈 — 환영 + 안내. 실제 이동은 좌측 사이드바로. */
export function HubHome() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="hubhome">
      <h1 className="sm-title">안녕하세요, {user.name} 님</h1>
      <p className="sm-desc">담당: {dutyLabel(user)} · 왼쪽 메뉴에서 화면을 선택하세요.</p>
      <div className="hub-card" style={{ marginTop: 20, maxWidth: 520 }}>
        <div className="hub-card-tag">바꿈 통합 허브</div>
        <p className="hub-muted">
          학생·특이사항·업무 보드는 모든 선생님이 함께 봅니다. 즐겨 쓰는 메뉴는 별(★)로 위에 모아둘 수 있어요.
        </p>
      </div>
    </div>
  );
}
