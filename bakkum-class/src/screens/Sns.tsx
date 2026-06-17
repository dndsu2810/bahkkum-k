import { useEffect, useRef, useState } from "react";
import { snsApi, uploadImage, type SnsPost, type SnsStatus } from "../lib/hubApi";
import { fmtWhen } from "../lib/dates";
import { ImageGrid } from "../components/ImageGrid";
import { Icon } from "../icons";

const CHANNELS = ["블로그", "인스타", "카카오톡채널"];

// 마케팅 뚝딱 메이커 — 별도 BYOK 앱. 새 탭 바로가기 + 노션 가이드 + 입장코드.
const MAKER_URL = "https://marketing-ttukddak-maker.dndsu2810.workers.dev/";
const MAKER_GUIDE_URL = "https://app.notion.com/p/37a66817e0618123a5e0ed544ed1006f";
const MAKER_CODE = "bahkkum";

function MarketingMakerCard() {
  const [copied, setCopied] = useState(false);
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(MAKER_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 클립보드 실패는 무시 */
    }
  }
  return (
    <div className="maker-card card">
      <div className="maker-card-main">
        <div className="maker-card-ic"><Icon name="sparkle" /></div>
        <div className="maker-card-text">
          <b>마케팅 뚝딱 메이커</b>
          <span>학원 블로그 글·카드뉴스를 우리 학원 색·말투로 자동 생성</span>
          <div className="maker-card-code">
            입장코드 <code>{MAKER_CODE}</code>
            <button className="maker-copy" onClick={copyCode}>{copied ? "복사됨 ✓" : "복사"}</button>
          </div>
        </div>
      </div>
      <div className="maker-card-actions">
        <a className="btn primary" href={MAKER_URL} target="_blank" rel="noopener noreferrer">열기 ↗</a>
        <a className="btn ghost" href={MAKER_GUIDE_URL} target="_blank" rel="noopener noreferrer">사용 가이드 ↗</a>
      </div>
    </div>
  );
}
const splitCh = (s: string): string[] => s.split(/[,·]/).map((x) => x.trim()).filter(Boolean);

const STATUS: { v: SnsStatus; label: string }[] = [
  { v: "wait", label: "업로드 대기" },
  { v: "edit", label: "수정필요" },
  { v: "stop", label: "업로드 중지" },
  { v: "done", label: "업로드 완료" },
];
const stLabel = (v: string) => STATUS.find((s) => s.v === v)?.label || v;

type Draft = { id?: string; title: string; body: string; channel: string; status: SnsStatus; link: string; images: string[] } | null;

/** SNS 관리 — 강사/원장이 글 등록 → 데스크가 본문 복붙 업로드 → 완료·링크 기록. */
const FILTERS: { v: SnsStatus | "all"; label: string }[] = [
  { v: "wait", label: "업로드 대기" },
  { v: "done", label: "업로드 완료" },
  { v: "stop", label: "업로드 중지" },
  { v: "edit", label: "수정필요" },
  { v: "all", label: "전체" },
];

export function Sns() {
  const [posts, setPosts] = useState<SnsPost[]>([]);
  const [draft, setDraft] = useState<Draft>(null);
  const [copiedId, setCopiedId] = useState("");
  const [openId, setOpenId] = useState(""); // 본문 펼친 카드(제목 클릭 시)
  const [filter, setFilter] = useState<SnsStatus | "all">("wait");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function toggleChannel(ch: string) {
    if (!draft) return;
    const cur = splitCh(draft.channel);
    const next = cur.includes(ch) ? cur.filter((x) => x !== ch) : [...cur, ch];
    setDraft({ ...draft, channel: next.join(", ") });
  }
  async function onPickFiles(files: FileList | null) {
    if (!draft || !files || !files.length) return;
    setUploading(true);
    setErr("");
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) continue;
        urls.push(await uploadImage(f));
      }
      setDraft((d) => (d ? { ...d, images: [...d.images, ...urls] } : d));
    } catch {
      setErr("이미지 업로드에 실패했어요.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  function removeDraftImage(url: string) {
    setDraft((d) => (d ? { ...d, images: d.images.filter((x) => x !== url) } : d));
  }

  const shown = filter === "all" ? posts : posts.filter((p) => p.status === filter);
  const countOf = (v: SnsStatus | "all") => (v === "all" ? posts.length : posts.filter((p) => p.status === v).length);

  async function reload() {
    try {
      setPosts(await snsApi.list());
      setErr("");
    } catch {
      setErr("불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }
  useEffect(() => {
    void reload();
  }, []);

  async function save() {
    if (!draft || !draft.title.trim()) return;
    try {
      await snsApi.save({
        id: draft.id,
        title: draft.title.trim(),
        body: draft.body,
        channel: draft.channel,
        status: draft.status,
        link: draft.link,
        images: draft.images,
      });
      setDraft(null);
      await reload();
    } catch {
      setErr("저장에 실패했어요.");
    }
  }
  async function patchStatus(p: SnsPost, status: SnsStatus, link?: string) {
    try {
      await snsApi.save({ id: p.id, title: p.title, body: p.body, channel: p.channel, status, link: link ?? p.link, images: p.images });
      await reload();
    } catch {
      setErr("변경에 실패했어요.");
    }
  }
  async function remove(p: SnsPost) {
    if (!window.confirm("이 글을 삭제할까요?")) return;
    try {
      await snsApi.remove(p.id);
      await reload();
    } catch {
      setErr("삭제 권한이 없거나 실패했어요.");
    }
  }
  async function copyBody(p: SnsPost) {
    try {
      await navigator.clipboard.writeText(p.body || "");
      setCopiedId(p.id);
      setTimeout(() => setCopiedId((c) => (c === p.id ? "" : c)), 1500);
    } catch {
      setErr("복사가 안 됐어요. 본문을 직접 선택해 복사해 주세요.");
    }
  }

  return (
    <div className="sns">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">SNS 관리</h1>
          <p className="sm-desc">글 등록 → 데스크가 본문 복사해 업로드 → 완료·링크 기록.</p>
        </div>
        <button className="btn primary" onClick={() => setDraft({ title: "", body: "", channel: "블로그", status: "wait", link: "", images: [] })}>
          글 등록
        </button>
      </div>

      <MarketingMakerCard />

      <div className="sm-filters" style={{ margin: "4px 0 12px" }}>
        {FILTERS.map((f) => (
          <button key={f.v} className={"sm-fchip" + (filter === f.v ? " on" : "")} onClick={() => setFilter(f.v)}>
            {f.label} <span className="sns-fcnt">{countOf(f.v)}</span>
          </button>
        ))}
      </div>

      {err && <div className="auth-err" style={{ margin: "8px 0" }}>{err}</div>}

      {draft && (
        <div className="sns-form card">
          <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="제목" />
          <div>
            <div className="acct-form-sub">올릴 곳 (중복 선택)</div>
            <div className="area-chips">
              {CHANNELS.map((ch) => {
                const on = splitCh(draft.channel).includes(ch);
                return (
                  <label key={ch} className={"area-chip" + (on ? " on" : "")}>
                    <input type="checkbox" checked={on} onChange={() => toggleChannel(ch)} />
                    {ch}
                  </label>
                );
              })}
              <select className="sm-input" style={{ marginLeft: "auto" }} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as SnsStatus })}>
                {STATUS.map((s) => (
                  <option key={s.v} value={s.v}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
          <textarea className="input" rows={6} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="본문" />

          <div>
            <div className="acct-form-sub">이미지</div>
            {draft.images.length > 0 && (
              <div className="imgrid" style={{ marginTop: 4 }}>
                {draft.images.map((src) => (
                  <div className="sns-draft-img" key={src}>
                    <img src={src} alt="" />
                    <button className="sns-draft-x" onClick={() => removeDraftImage(src)} title="제거">×</button>
                  </div>
                ))}
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => onPickFiles(e.target.files)} />
            <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "업로드 중…" : "+ 이미지 추가"}
            </button>
          </div>

          <input className="input" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} placeholder="업로드 링크 (업로드 후)" />
          <div className="wiki-edit-act">
            <button className="btn primary" onClick={save} disabled={!draft.title.trim()}>저장</button>
            <button className="btn ghost" onClick={() => setDraft(null)}>취소</button>
          </div>
        </div>
      )}

      <div className="sns-list">
        {shown.length === 0 ? (
          <div className="hub-muted">{filter === "all" ? "등록된 글이 없어요." : "이 상태의 글이 없어요."}</div>
        ) : (
          shown.map((p) => {
            const open = openId === p.id;
            return (
            <div className={"sns-card" + (open ? " open" : "")} key={p.id}>
              <div className="sns-card-h">
                <button className="sns-title-btn" onClick={() => setOpenId(open ? "" : p.id)} title="제목을 누르면 본문이 펼쳐져요">
                  <Icon name="chev" /><b>{p.title}</b>
                </button>
                {splitCh(p.channel).map((ch) => (
                  <span className="sns-ch" key={ch}>{ch}</span>
                ))}
                <span className={"sns-st st-" + p.status}>{stLabel(p.status)}</span>
                <span className="sns-meta">{p.authorName} · {fmtWhen(p.createdAt)}</span>
              </div>
              {p.images.length > 0 && <ImageGrid images={p.images} />}
              {open && p.body && <div className="sns-body">{p.body}</div>}
              {open && p.link && (
                <a className="sns-link" href={p.link} target="_blank" rel="noreferrer">{p.link}</a>
              )}
              <div className="sns-card-act">
                <button className="btn ghost sm" onClick={() => copyBody(p)}>{copiedId === p.id ? "복사됨!" : "본문 복사"}</button>
                {p.status !== "done" ? (
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      const link = window.prompt("업로드 링크를 입력하세요 (선택)", p.link || "");
                      void patchStatus(p, "done", link ?? p.link);
                    }}
                  >
                    업로드 완료로
                  </button>
                ) : (
                  <button className="btn ghost sm" onClick={() => patchStatus(p, "wait")}>대기로 되돌리기</button>
                )}
                <select className="sm-input" value={p.status} onChange={(e) => patchStatus(p, e.target.value as SnsStatus)}>
                  {STATUS.map((s) => (
                    <option key={s.v} value={s.v}>{s.label}</option>
                  ))}
                </select>
                <button className="btn ghost sm" onClick={() => setDraft({ id: p.id, title: p.title, body: p.body, channel: p.channel, status: p.status, link: p.link, images: p.images })}>편집</button>
                <button className="btn ghost sm" onClick={() => remove(p)}>삭제</button>
              </div>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}
