import { useEffect, useState } from "react";
import { feedbackApi, ISSUE_PAGES, ISSUE_STATUSES, type Issue } from "../lib/feedbackApi";
import { uploadImage } from "../lib/configApi";
import { fmtWhen } from "../lib/dates";

const ROLE_LABEL: Record<string, string> = { admin: "원장", math: "수학", english_mid: "영어(중고등)", english_elem: "영어(초등)", desk: "데스크", student: "학생" };
const statusCls = (s: string) => (s === "완료" ? "done" : s === "해결중" ? "doing" : "new");

/** 오류·개선 요청 — 누구나 작성(작성자 자동), 원장이 상태 변경. */
export function IssueBoard({ defaultPage }: { defaultPage?: string } = {}) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  // 작성 폼
  const [page, setPage] = useState(defaultPage || "");
  const [body, setBody] = useState("");
  const [shot, setShot] = useState("");
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
      setErr("불러오지 못했어요. (배포 환경에서만 동작)");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function submit() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      await feedbackApi.createIssue({ page, body: body.trim(), shot });
      setBody("");
      setShot("");
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
  async function remove(i: Issue) {
    if (!window.confirm("이 요청을 삭제할까요?")) return;
    try {
      await feedbackApi.removeIssue(i.id);
      await reload();
    } catch {
      setErr("삭제에 실패했어요.");
    }
  }

  const shown = filter === "all" ? issues : issues.filter((i) => i.status === filter);
  const countOf = (s: string) => (s === "all" ? issues.length : issues.filter((i) => i.status === s).length);

  return (
    <div className="issue">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">오류·개선 요청</h1>
          <p className="sm-desc">불편하거나 고쳤으면 하는 점을 적어 주세요. 지현T에게 바로 전달됩니다.</p>
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
            {shot ? "사진 변경" : "📷 스크린샷"}
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onShot(e.target.files?.[0])} />
          </label>
        </div>
        {shot && (
          <div className="issue-shot-prev">
            <img src={shot} alt="" />
            <button className="issue-shot-x" onClick={() => setShot("")}>×</button>
          </div>
        )}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
