import { useEffect, useState } from "react";
import { feedbackApi, type Notice } from "../lib/feedbackApi";
import { postApi } from "../lib/postApi";
import { sanitizeHtml } from "../lib/richText";
import { Icon } from "../icons";

const DISMISS_KEY = "bk_notice_dismissed";
function dismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

/** 공지 배너 — 활성 공지가 있을 때만 상단에 뜬다(없으면 렌더 안 함).
 *  배너를 누르면 본문 팝업(게시글이면 글 본문, 아니면 공지 문구). × 누르면 그 사람 화면에선 접힘. */
export function NoticeBanner() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(dismissed);
  const [detail, setDetail] = useState<{ title: string; html?: string; text?: string } | null>(null);
  const [loading, setLoading] = useState(false);

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

  // 배너 클릭 → 본문 팝업. 게시글 배너(post_<id>)면 글 본문을 불러오고, 아니면 공지 문구를 보여준다.
  async function open(n: Notice) {
    if (n.id.startsWith("post_")) {
      setLoading(true);
      setDetail({ title: n.text });
      try {
        const post = await postApi.get(n.id.slice(5));
        setDetail({ title: post.title, html: sanitizeHtml(post.body) });
      } catch {
        setDetail({ title: "공지사항", text: n.text });
      } finally {
        setLoading(false);
      }
    } else {
      setDetail({ title: "공지사항", text: n.text });
    }
  }

  if (!shown.length && !detail) return null;

  return (
    <>
      {shown.length > 0 && (
        <div className="notice-wrap">
          {shown.map((n) => (
            <div key={n.id} className={"notice-band " + (n.level === "warn" ? "warn" : "info")} role="button" tabIndex={0} onClick={() => open(n)} onKeyDown={(e) => { if (e.key === "Enter") open(n); }} title="눌러서 자세히 보기">
              <span className="notice-ic"><Icon name="megaphone" /></span>
              <span className="notice-text">{n.text}</span>
              <button className="notice-x" onClick={(e) => { e.stopPropagation(); close(n.id); }} aria-label="닫기">✕</button>
            </div>
          ))}
        </div>
      )}
      {detail && (
        <div className="overlay open" onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className="modal">
            <div className="modal-head">
              <div className="modal-title">{detail.title}</div>
              <button className="modal-x" onClick={() => setDetail(null)} aria-label="닫기"><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              {loading ? (
                <div className="hub-muted">불러오는 중…</div>
              ) : detail.html ? (
                <div className="mt-rich" dangerouslySetInnerHTML={{ __html: detail.html }} />
              ) : (
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{detail.text}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
