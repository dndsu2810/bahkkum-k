import { useEffect, useState } from "react";
import { postApi, uploadFile, type PostDetail, type PostFile, type PostListItem } from "../lib/postApi";
import { useAuth } from "../auth";
import { sanitizeHtml } from "../lib/richText";
import { RichEditor } from "../components/RichEditor";
import { fmtWhen } from "../lib/dates";
import { Icon } from "../icons";
import { EmptyHive } from "../soez";

type Mode = { kind: "list" } | { kind: "detail"; id: string } | { kind: "edit"; id?: string };

function fmtSize(n: number): string {
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + "KB";
  return (n / 1024 / 1024).toFixed(1) + "MB";
}

/** 공지사항 게시판 — 기능 업데이트·강사 할 일·자료 공유. readOnly면 학생용(조회만). */
export function Notices({ readOnly }: { readOnly?: boolean } = {}) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  if (mode.kind === "edit") return <NoticeEditor id={mode.id} onDone={() => setMode({ kind: "list" })} onCancel={() => setMode(mode.id ? { kind: "detail", id: mode.id } : { kind: "list" })} />;
  if (mode.kind === "detail") return <NoticeDetail id={mode.id} readOnly={readOnly} onBack={() => setMode({ kind: "list" })} onEdit={(id) => setMode({ kind: "edit", id })} />;
  return <NoticeList readOnly={readOnly} onNew={() => setMode({ kind: "edit" })} onOpen={(id) => setMode({ kind: "detail", id })} />;
}

/* ─────────── 목록 ─────────── */
function NoticeList({ readOnly, onNew, onOpen }: { readOnly?: boolean; onNew: () => void; onOpen: (id: string) => void }) {
  const [items, setItems] = useState<PostListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    postApi.list()
      .then((r) => { if (alive) { setItems(r); setErr(""); } })
      .catch(() => { if (alive) setErr("불러오지 못했어요."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="mt">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">공지사항</h1>
          <p className="sm-desc">기능 업데이트·강사 할 일·자료를 올려 공유해요. 파일도 첨부할 수 있어요.</p>
        </div>
        {!readOnly && <button className="btn primary" onClick={onNew}><Icon name="plus" /> 새 공지</button>}
      </div>

      {loading ? (
        <div className="mt-loading">불러오는 중…</div>
      ) : err ? (
        <div className="mt-err">{err}</div>
      ) : items.length === 0 ? (
        <EmptyHive caption="아직 공지가 없어요." sub={readOnly ? "" : "새 공지를 올려보세요."} />
      ) : (
        <div className="mt-list">
          {items.map((n) => (
            <button key={n.id} className="mt-card card" onClick={() => onOpen(n.id)}>
              <div className="mt-card-top">
                <div className="mt-card-titrow">
                  {!n.read && <span className="po-new">N</span>}
                  {n.banner && <span className="po-banner">배너</span>}
                  <span className={"mt-cat " + (n.audience === "all" ? "" : "po-staff")}>{n.audience === "all" ? "전체" : "강사만"}</span>
                  <b className="mt-card-title">{n.title}</b>
                </div>
                <span className="mt-card-date">{fmtWhen(n.createdAt)}</span>
              </div>
              <div className="mt-card-meta">
                <span className="mt-card-by">{n.authorName}{n.editorName && ` · 수정 ${n.editorName}`}</span>
                {n.fileCount > 0 && <span className="po-files"><Icon name="copy" /> 첨부 {n.fileCount}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── 상세 ─────────── */
function NoticeDetail({ id, readOnly, onBack, onEdit }: { id: string; readOnly?: boolean; onBack: () => void; onEdit: (id: string) => void }) {
  const { user } = useAuth();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    postApi.get(id)
      .then((r) => { if (alive) { setPost(r); setErr(""); window.dispatchEvent(new Event("posts-seen")); } })
      .catch(() => { if (alive) setErr("불러오지 못했어요."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  async function remove() {
    if (!window.confirm("이 공지를 삭제할까요?")) return;
    try { await postApi.remove(id); onBack(); } catch { setErr("삭제에 실패했어요."); }
  }

  if (loading) return <div className="mt"><div className="mt-loading">불러오는 중…</div></div>;
  if (err || !post) return <div className="mt"><div className="mt-err">{err || "찾을 수 없어요."}</div></div>;
  const canEdit = !readOnly && !!user && (user.role === "admin" || user.sub === post.authorSub);

  return (
    <div className="mt">
      <div className="sm-head">
        <div>
          <button className="mt-back" onClick={onBack}><Icon name="chev" /> 목록으로</button>
          <div className="mt-card-titrow">
            {post.banner && <span className="po-banner">배너</span>}
            <span className={"mt-cat " + (post.audience === "all" ? "" : "po-staff")}>{post.audience === "all" ? "전체" : "강사만"}</span>
            <h1 className="sm-title">{post.title}</h1>
          </div>
          <p className="sm-desc">{post.authorName} · {fmtWhen(post.createdAt)}{post.editorName && ` · 수정 ${post.editorName}`}</p>
        </div>
        {canEdit && (
          <div className="mt-detail-actions">
            <button className="btn ghost" onClick={() => onEdit(id)}><Icon name="edit" /> 수정</button>
            <button className="btn ghost danger" onClick={remove}><Icon name="trash" /> 삭제</button>
          </div>
        )}
      </div>

      <div className="mt-rich card" dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.body) }} />

      {post.files.length > 0 && (
        <div className="po-filelist card">
          <div className="po-filelist-h">첨부 파일</div>
          {post.files.map((f, i) => (
            <a className="po-file" key={i} href={f.url} download={f.name}>
              <Icon name="copy" /> <span className="po-file-n">{f.name}</span> <span className="po-file-s">{fmtSize(f.size)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────── 작성/수정 ─────────── */
function NoticeEditor({ id, onDone, onCancel }: { id?: string; onDone: () => void; onCancel: () => void }) {
  const editing = !!id;
  const [loaded, setLoaded] = useState(!editing);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"staff" | "all">("staff");
  const [banner, setBanner] = useState(false);
  const [files, setFiles] = useState<PostFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!editing || !id) return;
    let alive = true;
    postApi.get(id).then((p) => {
      if (!alive) return;
      setTitle(p.title); setBody(p.body); setAudience(p.audience); setBanner(p.banner); setFiles(p.files);
      setLoaded(true);
    }).catch(() => { if (alive) { setErr("불러오지 못했어요."); setLoaded(true); } });
    return () => { alive = false; };
  }, [editing, id]);

  async function onPickFiles(list: FileList | null) {
    if (!list || !list.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(list)) {
        if (f.size > 25 * 1024 * 1024) { setErr(`${f.name}은 25MB를 넘어 올릴 수 없어요.`); continue; }
        const up = await uploadFile(f);
        setFiles((cur) => [...cur, up]);
      }
    } catch { setErr("파일 업로드에 실패했어요."); }
    finally { setUploading(false); }
  }

  async function save() {
    if (!title.trim()) { setErr("제목을 입력해 주세요."); return; }
    const scope = audience === "all" ? "학생 포함 전체" : "강사만";
    const ok = window.confirm(`이 공지를 등록할까요?\n\n공개 범위: ${scope}\n${banner ? "상단 공지 배너로도 띄웁니다." : "배너로는 띄우지 않습니다."}`);
    if (!ok) return;
    setSaving(true);
    try {
      await postApi.save({ id, title: title.trim(), body, files, audience, banner });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : "저장에 실패했어요."); setSaving(false); }
  }

  if (!loaded) return <div className="mt"><div className="mt-loading">불러오는 중…</div></div>;

  return (
    <div className="mt">
      <div className="sm-head">
        <div>
          <button className="mt-back" onClick={onCancel}><Icon name="chev" /> 뒤로</button>
          <h1 className="sm-title">{editing ? "공지 수정" : "새 공지"}</h1>
        </div>
      </div>

      <div className="card mt-form">
        <label className="mt-f">
          <span>제목 <i>*</i></span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 회의록 기능 업데이트 안내" />
        </label>

        <div className="mt-f">
          <span>내용</span>
          <RichEditor value={body} onChange={setBody} placeholder="내용을 작성하세요. 제목 크기·형광펜·인용·콜아웃·이미지를 쓸 수 있어요." />
        </div>

        <div className="mt-f">
          <span>첨부 파일</span>
          {files.length > 0 && (
            <div className="po-chips">
              {files.map((f, i) => (
                <span className="po-chip" key={i}>
                  {f.name} <span className="po-chip-s">{fmtSize(f.size)}</span>
                  <button className="po-chip-x" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label="삭제">×</button>
                </span>
              ))}
            </div>
          )}
          <label className="btn ghost sm po-upload">
            <Icon name="plus" /> {uploading ? "올리는 중…" : "파일 추가"}
            <input type="file" multiple style={{ display: "none" }} onChange={(e) => { onPickFiles(e.target.files); e.target.value = ""; }} />
          </label>
        </div>

        <div className="mt-f">
          <span>공개 범위</span>
          <div className="mt-att-chips">
            <button type="button" className={"mt-chip" + (audience === "staff" ? " on" : "")} onClick={() => setAudience("staff")}>강사만</button>
            <button type="button" className={"mt-chip" + (audience === "all" ? " on" : "")} onClick={() => setAudience("all")}>학생 포함 전체</button>
          </div>
        </div>

        <label className="po-banner-check">
          <input type="checkbox" checked={banner} onChange={(e) => setBanner(e.target.checked)} />
          <span>공지 배너로 등록 (상단에 띄우기 · 체크 해제하면 내려가요)</span>
        </label>

        {err && <div className="mt-err">{err}</div>}
        <div className="mt-save-foot">
          <button className="btn primary" onClick={save} disabled={saving || uploading}>{saving ? "등록 중…" : editing ? "수정 저장" : "등록"}</button>
          <button className="btn ghost" onClick={onCancel}>취소</button>
        </div>
      </div>
    </div>
  );
}
