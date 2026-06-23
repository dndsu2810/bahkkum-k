import { useEffect, useState } from "react";
import { feedbackApi, ISSUE_PAGES, ISSUE_STATUSES, ISSUE_STATUS_ORDER, type Issue } from "../lib/feedbackApi";
import { uploadImage } from "../lib/configApi";
import { fmtWhen } from "../lib/dates";
import { useAuth } from "../auth";
import { Icon } from "../icons";
import { EmptyHive } from "../soez";

const ROLE_LABEL: Record<string, string> = { admin: "원장", developer: "개발자", math: "수학", english_mid: "영어(중고등)", english_elem: "영어(초등)", desk: "데스크", student: "학생" };
const statusCls = (s: string) => (s === "완료" ? "done" : s === "보류" ? "hold" : s === "진행중" || s === "해결중" ? "doing" : "new");

/** 오류·개선 요청 — 누구나 작성(작성자 자동), 원장이 상태 변경. */
export function IssueBoard({ defaultPage }: { defaultPage?: string } = {}) {
  const { user } = useAuth();
  const mySub = user?.sub || "";
  const [issues, setIssues] = useState<Issue[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  // 작성 폼
  const [page, setPage] = useState(defaultPage || "");
  const [customPage, setCustomPage] = useState(""); // '직접 입력' 선택 시 화면 이름
  const [body, setBody] = useState("");
  const [shot, setShot] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  // silent=true면 '불러오는 중…' 표시 없이 데이터만 제자리 갱신(목록 언마운트·스크롤 점프 방지).
  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const r = await feedbackApi.issues();
      setIssues(r.issues);
      setIsAdmin(r.isAdmin);
      setErr("");
    } catch {
      if (!silent) setErr("불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (!silent) setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    // 이 화면을 열면 내 글의 새 답변·해결을 '확인함'으로 → 종 배지 정리.
    feedbackApi.markIssuesSeen().then(() => window.dispatchEvent(new Event("issue-seen"))).catch(() => {});
  }, []);

  async function submit() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      const screen = page === "__custom__" ? customPage.trim() : page;
      await feedbackApi.createIssue({ page: screen, body: body.trim(), shot, link: link.trim() });
      setBody("");
      setShot("");
      setLink("");
      setPage(defaultPage || "");
      setCustomPage("");
      setSent(true);
      setTimeout(() => setSent(false), 2000);
      await refresh(true);
    } catch {
      setErr("등록에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  async function onShot(file?: File | null) {
    if (!file) return;
    try {
      setShot(await uploadImage(file));
    } catch {
      setErr("이미지 업로드에 실패했어요.");
    }
  }
  async function setStatus(i: Issue, status: string) {
    setIssues((cur) => cur.map((x) => (x.id === i.id ? { ...x, status } : x))); // 즉시 반영
    try {
      await feedbackApi.setIssueStatus(i.id, status);
    } catch {
      setErr("상태 변경에 실패했어요.");
      await refresh(true);
    }
  }
  async function sendReply(i: Issue, reply: string, shot?: string) {
    try {
      await feedbackApi.replyIssue(i.id, reply.trim(), shot);
      await refresh(true); // 서버가 만든 답변 id·시각 반영(조용히)
    } catch {
      setErr("답변 저장에 실패했어요.");
    }
  }
  async function deleteReply(replyId: string) {
    if (!window.confirm("이 답변을 삭제할까요?")) return;
    setIssues((cur) => cur.map((x) => ({ ...x, replies: (x.replies || []).filter((r) => r.id !== replyId) }))); // 즉시 반영
    try {
      await feedbackApi.removeReply(replyId);
    } catch {
      setErr("답변 삭제에 실패했어요.");
      await refresh(true);
    }
  }
  async function remove(i: Issue) {
    if (!window.confirm("이 요청을 삭제할까요?")) return;
    setIssues((cur) => cur.filter((x) => x.id !== i.id)); // 즉시 반영
    try {
      await feedbackApi.removeIssue(i.id);
    } catch {
      setErr("삭제에 실패했어요.");
      await refresh(true);
    }
  }

  // '전체' 보기는 접수→진행중→보류→완료 순으로, 같은 상태 안에서는 최신순.
  const shown =
    filter === "all"
      ? [...issues].sort((a, b) => {
          const oa = ISSUE_STATUS_ORDER[a.status] ?? 9;
          const ob = ISSUE_STATUS_ORDER[b.status] ?? 9;
          return oa !== ob ? oa - ob : b.createdAt - a.createdAt;
        })
      : issues.filter((i) => i.status === filter);
  const countOf = (s: string) => (s === "all" ? issues.length : issues.filter((i) => i.status === s).length);

  return (
    <div className="issue">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">오류·개선 요청 <span className="issue-to">To. 지현T</span></h1>
          <p className="sm-desc">요청사항이나 고쳐야 할 점을 지현T에게 보내세요. 어디가 문제인지 <b>링크</b>를 같이 넣으면 더 빨라요. 답변이 달리면 알림이 갑니다.</p>
        </div>
      </div>

      {/* 작성 폼 */}
      <div className="issue-form card">
        <div className="issue-form-row">
          <label className="issue-f">
            <span>어떤 화면</span>
            <select className="ctrl" value={page} onChange={(e) => setPage(e.target.value)}>
              <option value="">화면 선택(선택)</option>
              {ISSUE_PAGES.map((pg) => (
                <option key={pg} value={pg}>{pg}</option>
              ))}
              <option value="__custom__">직접 입력…</option>
            </select>
          </label>
          {page === "__custom__" && (
            <input
              className="input issue-custom-page"
              autoFocus
              value={customPage}
              onChange={(e) => setCustomPage(e.target.value)}
              placeholder="화면 이름을 직접 입력하세요 (예: 키오스크 등하원)"
            />
          )}
          <label className="issue-shot-btn">
            <Icon name="camera" /> {shot ? "사진 변경" : "스크린샷"}
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onShot(e.target.files?.[0])} />
          </label>
        </div>
        {shot && (
          <div className="issue-shot-prev">
            <img src={shot} alt="" />
            <button className="issue-shot-x" onClick={() => setShot("")}>×</button>
          </div>
        )}
        <input className="input" style={{ marginBottom: 8 }} value={link} onChange={(e) => setLink(e.target.value)} placeholder="어디가 문제인지 링크 (앱 주소·노션 링크 등 · 선택)" />
        <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="무슨 문제인지 / 어떻게 개선하면 좋을지 적어 주세요." />
        <div className="issue-form-foot">
          <button className="btn primary" onClick={submit} disabled={!body.trim() || busy}>{busy ? "보내는 중…" : "보내기"}</button>
          {sent && <span className="issue-sent">접수됐어요 ✓ 지현T에게 전달됐습니다.</span>}
        </div>
      </div>

      {err && <div className="auth-err" style={{ margin: "8px 0" }}>{err}</div>}

      {/* 목록 */}
      <div className="sm-filters" style={{ margin: "14px 0 10px" }}>
        {["all", ...ISSUE_STATUSES].map((s) => (
          <button key={s} className={"sm-fchip" + (filter === s ? " on" : "")} onClick={() => setFilter(s)}>
            {s === "all" ? "전체" : s} <span className="sns-fcnt">{countOf(s)}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="sp-muted">불러오는 중…</div>
      ) : !shown.length ? (
        <EmptyHive caption={filter === "all" ? "아직 등록된 요청이 없어요" : `'${filter}' 상태의 요청이 없어요`} sub={filter === "all" ? "고치고 싶은 점이 있으면 위에서 남겨 주세요." : undefined} />
      ) : (
        <div className="issue-list">
          {shown.map((i) => (
            <div className="issue-row card" key={i.id}>
              <div className="issue-row-top">
                <span className={"issue-st " + statusCls(i.status)}>{i.status}</span>
                {i.page && <span className="issue-page">{i.page}</span>}
                <span className="issue-meta">{i.authorName} · {ROLE_LABEL[i.authorRole] || i.authorRole} · {fmtWhen(i.createdAt)}</span>
                <button className="issue-del" onClick={() => remove(i)} title="삭제">×</button>
              </div>
              <div className="issue-body">{i.body}</div>
              {i.link && (
                <a className="issue-link" href={i.link} target="_blank" rel="noopener noreferrer">
                  <span className="issue-link-tag">링크</span> {i.link}
                </a>
              )}
              {i.shot && (
                <a className="issue-shot-link" href={i.shot} target="_blank" rel="noopener noreferrer">
                  <img src={i.shot} alt="첨부" />
                </a>
              )}
              {isAdmin && (
                <div className="issue-actions">
                  {ISSUE_STATUSES.map((s) => (
                    <button key={s} className={"issue-stbtn " + statusCls(s) + (i.status === s ? " on" : "")} onClick={() => setStatus(i, s)}>{s}</button>
                  ))}
                </div>
              )}
              <ReplyThread
                issue={i}
                mySub={mySub}
                isAdmin={isAdmin}
                canReply={isAdmin || i.authorSub === mySub}
                onSend={sendReply}
                onDelete={deleteReply}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 답변 스레드 — 작성자·시간이 남는 댓글. 원장과 글 작성자가 주고받고, 내 답글은 색으로 구분. */
function ReplyThread({
  issue,
  mySub,
  isAdmin,
  canReply,
  onSend,
  onDelete,
}: {
  issue: Issue;
  mySub: string;
  isAdmin: boolean;
  canReply: boolean;
  onSend: (i: Issue, text: string, shot?: string) => void;
  onDelete: (replyId: string) => void;
}) {
  const [v, setV] = useState("");
  const [shot, setShot] = useState("");
  const [upBusy, setUpBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const replies = issue.replies || [];
  async function onReplyShot(file?: File) {
    if (!file) return;
    setUpBusy(true);
    try { setShot(await uploadImage(file)); } catch { /* 업로드 실패 무시 */ } finally { setUpBusy(false); }
  }
  return (
    <div className="issue-thread">
      {replies.length > 0 && <div className="issue-thread-h">답변 {replies.length}</div>}
      {replies.map((r) => {
        const mine = !!r.authorSub && r.authorSub === mySub;
        return (
          <div className={"issue-msg" + (mine ? " mine" : "")} key={r.id}>
            <div className="issue-msg-h">
              <span className="issue-msg-who">{mine ? "나" : r.authorName || "이전 답변"}{r.authorName && r.authorRole ? ` · ${ROLE_LABEL[r.authorRole] || r.authorRole}` : ""}</span>
              <span className="issue-msg-t">{fmtWhen(r.createdAt)}</span>
              {(mine || isAdmin) && <button className="issue-msg-del" title="삭제" onClick={() => onDelete(r.id)}>×</button>}
            </div>
            {r.text && <div className="issue-msg-b">{r.text}</div>}
            {r.shot && (
              <a className="issue-shot-link" href={r.shot} target="_blank" rel="noopener noreferrer">
                <img src={r.shot} alt="첨부 이미지" />
              </a>
            )}
          </div>
        );
      })}
      {canReply &&
        (open ? (
          <div className="issue-reply-form">
            <textarea className="input" rows={2} value={v} onChange={(e) => setV(e.target.value)} placeholder={replies.length ? "답글 달기… (개선 결과는 이미지도 첨부할 수 있어요)" : "답변 쓰기… (이미지 첨부 가능)"} />
            {shot && (
              <div className="issue-shot-prev">
                <img src={shot} alt="첨부 미리보기" />
                <button className="issue-shot-x" onClick={() => setShot("")}>×</button>
              </div>
            )}
            <div className="issue-reply-act">
              <label className="issue-shot-btn">
                <Icon name="camera" /> {upBusy ? "올리는 중…" : shot ? "사진 변경" : "이미지"}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onReplyShot(e.target.files?.[0])} />
              </label>
              <button className="btn primary sm" onClick={() => { onSend(issue, v, shot); setV(""); setShot(""); setOpen(false); }} disabled={(!v.trim() && !shot) || upBusy}>보내기</button>
              <button className="btn ghost sm" onClick={() => { setV(""); setShot(""); setOpen(false); }}>취소</button>
            </div>
          </div>
        ) : (
          <button className="btn ghost sm issue-reply-edit" onClick={() => setOpen(true)}>
            <Icon name="edit" /> {replies.length ? "답글 달기" : "답변 쓰기"}
          </button>
        ))}
    </div>
  );
}
