import { useEffect, useState } from "react";
import { feedbackApi, type Notice } from "../lib/feedbackApi";

const DISMISS_KEY = "bk_notice_dismissed";
function dismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

/** 공지 배너 — 활성 공지가 있을 때만 상단에 뜬다(없으면 아무것도 렌더 안 함).
 *  × 누르면 그 사람 화면에선 접힘(localStorage, 다음 공지까지). */
export function NoticeBanner() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(dismissed);

  useEffect(() => {
    let alive = true;
    feedbackApi
      .notices()
      .then((n) => alive && setNotices(n))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const shown = notices.filter((n) => !hidden.has(n.id));
  if (!shown.length) return null;

  function close(id: string) {
    const next = new Set(hidden);
    next.add(id);
    setHidden(next);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="notice-wrap">
      {shown.map((n) => (
        <div key={n.id} className={"notice-band " + (n.level === "warn" ? "warn" : "info")}>
          <span className="notice-ic">📢</span>
          <span className="notice-text">{n.text}</span>
          <button className="notice-x" onClick={() => close(n.id)} aria-label="닫기">✕</button>
        </div>
      ))}
    </div>
  );
}
