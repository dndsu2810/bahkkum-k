import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

/** 공지 문구 — 한 줄을 넘기면 오른쪽→왼쪽으로 흐르는 슬라이드(마퀴), 짧으면 그대로 둔다.
 *  넘칠 때만 두 벌을 이어 붙여 끊김 없이 반복하고, 마우스를 올리면 멈춰서 읽기 좋게. */
function NoticeMarquee({ text }: { text: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLSpanElement>(null);
  const [scroll, setScroll] = useState(false);
  const [dur, setDur] = useState(12);

  useLayoutEffect(() => {
    function measure() {
      const wrap = wrapRef.current, item = itemRef.current;
      if (!wrap || !item) return;
      const itemW = item.scrollWidth - MQ_GAP; // 글자 폭(반복용 여백 제외)
      const over = itemW > wrap.clientWidth + 4;
      setScroll(over);
      if (over) setDur(Math.max(8, Math.round(item.scrollWidth / 55))); // 약 55px/초로 일정 속도
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div className="notice-mq" ref={wrapRef}>
      <div className={"notice-mq-track" + (scroll ? " run" : "")} style={scroll ? { animationDuration: `${dur}s` } : undefined}>
        <span className="notice-mq-item" ref={itemRef}>{text}</span>
        {scroll && <span className="notice-mq-item" aria-hidden="true">{text}</span>}
      </div>
    </div>
  );
}
const MQ_GAP = 48; // .notice-mq-item padding-right(px)와 일치 — 반복 간격

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
      // 세부 내용을 따로 적었으면 그걸 본문으로, 없으면 배너 문구 그대로.
      setDetail({ title: n.text, text: n.detail || n.text });
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
              <NoticeMarquee text={n.text} />
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
