import { useEffect, useState } from "react";
import { feedbackApi, ISSUE_PAGES, ISSUE_STATUSES, ISSUE_STATUS_ORDER, type Issue } from "../lib/feedbackApi";
import { uploadImage } from "../lib/configApi";
import { fmtWhen } from "../lib/dates";
import { useAuth } from "../auth";
import { Icon } from "../icons";

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
  const [body, setBody] = useState("");
  const [shot, setShot] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const r = await feedbackApi.issues();
      setIssues(r.issues);
      setIsAdmin(r.isAdmin);
      setErr("");
    } catch {
      setErr("불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    // 이 화면을 열면 내 글의 새 답변·해결을 '확인함'으로 → 종 배지 정리.
    feedbackApi.markIssuesSeen().then(() => window.dispatchEvent(new Event("issue-seen"))).catch(() => {});
  }, []);

  async function submit() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      await feedbackApi.createIssue({ page, body: body.trim(), shot, link: link.trim() });
      setBody("");
      setShot("");
      setLink("");
      setPage(defaultPage || "");
      setSent(true);
      setTimeout(() => setSent(false), 2000);
      await reload();
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
    try {
      await feedbackApi.setIssueStatus(i.id, status);
      await reload();
    } catch {
      setErr("상태 변경에 실패했어요.");
    }
  }
  async function sendReply(i: Issue, reply: string) {
    try {
      await feedbackApi.replyIssue(i.id, reply.trim());
      await reload();
    } catch {
      setErr("답변 저장에 실패했어요.");
    }
  }
  async function deleteReply(replyId: string) {
    if (!window.confirm("이 답변을 삭제할까요?")) return;
    try {
      await feedbackApi.removeReply(replyId);
      await reload();
    } catch {
      setErr("답변 삭제에 실패했어요.");
    }
  }
  async function remove(i: Issue) {
    if (!window.confirm("이 요청을 삭제할까요?")) return;
    try {
      await feedbackApi.removeIssue(i.id);
      await reload();
    } catch {
      setErr("삭제에 실패했어요.");
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
            </select>
          </label>
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
        <div className="issue-empty">{filter === "all" ? "아직 등록된 요청이 없어요." : `'${filter}' 상태의 요청이 없어요.`}</div>
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
  onSend: (i: Issue, text: string) => void;
  onDelete: (replyId: string) => void;
}) {
  const [v, setV] = useState("");
  const [open, setOpen] = useState(false);
  const replies = issue.replies || [];
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
            <div className="issue-msg-b">{r.text}</div>
          </div>
        );
      })}
      {canReply &&
        (open ? (
          <div className="issue-reply-form">
            <textarea className="input" rows={2} value={v} onChange={(e) => setV(e.target.value)} placeholder={replies.length ? "답글 달기… (누가 썼는지 함께 표시돼요)" : "답변 쓰기…"} />
            <div className="issue-reply-act">
              <button className="btn primary sm" onClick={() => { onSend(issue, v); setV(""); setOpen(false); }} disabled={!v.trim()}>보내기</button>
              <button className="btn ghost sm" onClick={() => { setV(""); setOpen(false); }}>취소</button>
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
