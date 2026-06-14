import { useAuth } from "../auth";
import { dutyLabel, type WsEntry } from "../lib/workspace";
import { Icon } from "../icons";

/** 허브 홈 — 인사 + 한 줄 목적 + 바로가기 타일. 실제 이동은 타일/사이드바로. */
export function HubHome({ tiles, onOpen }: { tiles: WsEntry[]; onOpen: (e: WsEntry) => void }) {
  const { user } = useAuth();
  if (!user) return null;
  // 원장은 전체 관리자 — '담당 과목' 문구를 표시하지 않는다.
  const purpose =
    user.role === "admin"
      ? "바꿈영수학원을 한 곳에서 관리하는 공간이에요."
      : `담당: ${dutyLabel(user)} · 자주 쓰는 곳으로 바로 들어가세요.`;
  return (
    <div className="hubhome">
      <h1 className="sm-title">안녕하세요, {user.name} 님</h1>
      <p className="sm-desc">{purpose}</p>

      {tiles.length > 0 && (
        <div className="home-tiles">
          {tiles.map((e) => (
            <button key={e.key} className="home-tile" onClick={() => onOpen(e)}>
              <span className="home-tile-ic"><Icon name={e.icon} /></span>
              <span className="home-tile-l">{e.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="hub-card" style={{ marginTop: 20, maxWidth: 520 }}>
        <div className="hub-card-tag">바꿈 통합 허브</div>
        <p className="hub-muted">
          학생·특이사항·업무 보드는 모든 선생님이 함께 봅니다. 즐겨 쓰는 메뉴는 별(★)로 위에 모아둘 수 있어요.
        </p>
      </div>
    </div>
  );
}
