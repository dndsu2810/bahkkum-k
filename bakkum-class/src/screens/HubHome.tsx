import { useAuth } from "../auth";
import { dutyLabel, type WsEntry } from "../lib/workspace";
import { Icon } from "../icons";

export interface HomeStat {
  key: string;
  label: string;
  value: number;
  icon: string;
  tone?: string; // "warn" → 0보다 클 때 강조
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** 허브 홈 — 인사 + 오늘 수업 바로가기 + 오늘 요약(클릭 이동) + 빠른 진입 타일. */
export function HubHome({
  tiles,
  onOpen,
  summary,
  ctaKey,
  onGo,
}: {
  tiles: WsEntry[];
  onOpen: (e: WsEntry) => void;
  summary: HomeStat[];
  ctaKey: string;
  onGo: (key: string) => void;
}) {
  const { user } = useAuth();
  if (!user) return null;
  // 원장은 전체 관리자 — '담당 과목' 문구를 표시하지 않는다.
  const purpose =
    user.role === "admin"
      ? "바꿈영수학원을 한 곳에서 관리하는 공간이에요."
      : `담당: ${dutyLabel(user)} · 자주 쓰는 곳으로 바로 들어가세요.`;
  const now = new Date();
  const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${DOW[now.getDay()]}요일`;
  const showCta = !!ctaKey && ctaKey !== "home";

  return (
    <div className="hubhome">
      <h1 className="sm-title">안녕하세요, {user.name} 님</h1>
      <p className="sm-desc">{purpose}</p>

      {showCta && (
        <button className="home-cta" onClick={() => onGo(ctaKey)}>
          <div className="home-cta-l">
            <span className="home-cta-date">{dateStr}</span>
            <b>오늘 수업 보기</b>
          </div>
          <span className="home-cta-ic"><Icon name="today" /></span>
        </button>
      )}

      {summary.length > 0 && (
        <div className="home-stats">
          {summary.map((s) => (
            <button
              key={s.key}
              className={"home-stat" + (s.tone === "warn" && s.value > 0 ? " warn" : "")}
              onClick={() => onGo(s.key)}
            >
              <span className="home-stat-ic"><Icon name={s.icon} /></span>
              <span className="home-stat-v">{s.value}</span>
              <span className="home-stat-l">{s.label}</span>
            </button>
          ))}
        </div>
      )}

      {tiles.length > 0 && (
        <>
          <div className="home-sec-h">바로 가기</div>
          <div className="home-tiles">
            {tiles.map((e) => (
              <button key={e.key} className="home-tile" onClick={() => onOpen(e)}>
                <span className="home-tile-ic"><Icon name={e.icon} /></span>
                <span className="home-tile-l">{e.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
