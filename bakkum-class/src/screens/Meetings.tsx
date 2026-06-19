import { useEffect, useMemo, useRef, useState } from "react";
import { meetingApi, type MeetingDetail, type MeetingListItem } from "../lib/meetingApi";
import { listUsers, type UserRow } from "../lib/authApi";
import { useAuth } from "../auth";
import { tasksApi, type BoardTask } from "../lib/hubApi";
import { TaskModal, blankTask } from "../components/TaskModal";
import { ROLE_LABEL } from "../lib/roles";
import { sanitizeHtml, htmlToText, hasContent } from "../lib/richText";
import { RichEditor } from "../components/RichEditor";
import { Icon } from "../icons";
import { EmptyHive } from "../soez";

type Mode = { kind: "list" } | { kind: "edit"; id?: number } | { kind: "detail"; id: number };

function today(): string {
  const d = new Date();
  const p = (n: number) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function fmtSec(s: number): string {
  const m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0");
}

/** 회의록 — 회의안 미리 작성 + 음성/텍스트 AI 요약. */
export function Meetings() {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  if (mode.kind === "edit") return <MeetingEditor id={mode.id} onDone={() => setMode({ kind: "list" })} onCancel={() => setMode({ kind: "list" })} />;
  if (mode.kind === "detail") return <MeetingDetailView id={mode.id} onBack={() => setMode({ kind: "list" })} onEdit={(id) => setMode({ kind: "edit", id })} />;
  return <MeetingList onNew={() => setMode({ kind: "edit" })} onOpen={(id) => setMode({ kind: "detail", id })} />;
}

/* ─────────────────────── 목록 ─────────────────────── */
function MeetingList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: number) => void }) {
  const [items, setItems] = useState<MeetingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [cat, setCat] = useState("전체");
  useEffect(() => {
    let alive = true;
    meetingApi
      .list()
      .then((r) => { if (alive) { setItems(r); setErr(""); } })
      .catch(() => { if (alive) setErr("불러오지 못했어요. 잠시 후 다시 시도해 주세요."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const cats = useMemo(() => {
    const s: string[] = [];
    for (const m of items) if (m.category && !s.includes(m.category)) s.push(m.category);
    return s;
  }, [items]);
  const shown = cat === "전체" ? items : items.filter((m) => m.category === cat);

  return (
    <div className="mt">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">회의록</h1>
          <p className="sm-desc">회의 전 안건을 미리 적고, 녹음·텍스트를 올리면 AI가 핵심·결정사항·할일로 정리해 줘요. 내가 만들었거나 참석한 회의만 보여요.</p>
        </div>
        <button className="btn primary" onClick={onNew}><Icon name="plus" /> 새 회의록</button>
      </div>

      {cats.length > 0 && (
        <div className="mt-filter">
          {["전체", ...cats].map((c) => (
            <button key={c} className={"mt-fchip" + (cat === c ? " on" : "")} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="mt-loading">불러오는 중…</div>
      ) : err ? (
        <div className="mt-err">{err}</div>
      ) : shown.length === 0 ? (
        <EmptyHive caption="아직 저장된 회의록이 없어요." sub="새 회의록을 만들어보세요." />
      ) : (
        <div className="mt-list">
          {shown.map((m) => (
            <button key={m.id} className="mt-card card" onClick={() => onOpen(m.id)}>
              <div className="mt-card-top">
                <div className="mt-card-titrow">
                  {m.category && <span className="mt-cat">{m.category}</span>}
                  <b className="mt-card-title">{m.title}</b>
                </div>
                <span className="mt-card-date">{m.meetingDate}</span>
              </div>
              <div className="mt-card-meta">
                <span className={"mt-status " + (m.status === "예정" ? "plan" : "done")}>{m.status === "예정" ? "회의안 작성됨" : "요약 완료"}</span>
                {m.attendees ? <span className="mt-card-att"><Icon name="users" /> {m.attendees}</span> : null}
                {m.createdBy && <span className="mt-card-by">기록 {m.createdBy}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── 작성/수정 ─────────────────────── */
const ACCEPT = ".mp3,.m4a,.wav,.ogg,.webm,audio/*";
const MAX_BYTES = 25 * 1024 * 1024;

function MeetingEditor({ id, onDone, onCancel }: { id?: number; onDone: () => void; onCancel: () => void }) {
  const editing = !!id;
  const [loaded, setLoaded] = useState(!editing);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [staff, setStaff] = useState<UserRow[]>([]);
  const [picked, setPicked] = useState<string[]>([]); // 참석자 user id(sub)
  const [agenda, setAgenda] = useState("");
  const [tab, setTab] = useState<"audio" | "text">("audio");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ rawText: string; summary: string } | null>(null);
  const [addingCat, setAddingCat] = useState(false);
  const [newCat, setNewCat] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // 녹음(MediaRecorder)
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const [level, setLevel] = useState(0); // 입력 레벨(0~1) — 소리가 잡히는지 눈으로 확인
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const maxLevelRef = useRef(0);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    setLevel(0);
  }
  useEffect(() => () => stopStream(), []);

  // 연결된 마이크 목록 — 어떤 마이크로 녹음할지 고르게(아이폰/컴퓨터 혼선 방지).
  async function loadMics() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setMics(all.filter((d) => d.kind === "audioinput"));
    } catch { /* ignore */ }
  }
  useEffect(() => { void loadMics(); }, []);

  // 강사·종류 로드 + (수정 시) 기존 회의 로드.
  useEffect(() => {
    let alive = true;
    listUsers().then((u) => { if (alive) setStaff(u.filter((x) => x.role !== "student")); }).catch(() => {});
    meetingApi.categories().then((c) => { if (alive) setCategories(c); }).catch(() => {});
    if (editing && id) {
      meetingApi.get(id).then((m) => {
        if (!alive) return;
        setTitle(m.title);
        setDate(m.meetingDate || today());
        setCategory(m.category || "");
        setPicked(m.attendeeSubs || []);
        setAgenda(m.agenda || "");
        if (m.rawText) setText(m.rawText);
        if (m.summary) setResult({ rawText: m.rawText, summary: m.summary });
        setLoaded(true);
      }).catch(() => { if (alive) { setErr("회의록을 불러오지 못했어요."); setLoaded(true); } });
    }
    return () => { alive = false; };
  }, [editing, id]);

  function toggleAttendee(sub: string) {
    setPicked((cur) => (cur.includes(sub) ? cur.filter((s) => s !== sub) : [...cur, sub]));
  }
  function pickFile(f: File | undefined) {
    setErr("");
    if (!f) { setFile(null); return; }
    if (f.size > MAX_BYTES) { setErr("음성 파일은 25MB 이하만 올릴 수 있어요."); return; }
    setFile(f);
  }
  async function addCategory() {
    const name = newCat.trim();
    if (!name) { setAddingCat(false); return; }
    try {
      const r = await meetingApi.addCategory(name);
      setCategories(r.categories);
      setCategory(name);
    } catch { /* ignore */ }
    setNewCat("");
    setAddingCat(false);
  }

  async function startRec() {
    setErr("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErr("이 브라우저는 녹음을 지원하지 않아요. 파일 업로드를 이용해 주세요.");
      return;
    }
    try {
      // 작은 목소리도 잡히게 자동 게인·노이즈 억제 켜기 + 선택한 마이크 사용.
      const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (micId) audio.deviceId = { exact: micId };
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      streamRef.current = stream;
      void loadMics(); // 권한 허용 후엔 마이크 이름이 보이므로 목록 갱신
      // 입력 레벨 미터 — 소리가 실제로 들어오는지 눈으로 확인(아이폰/컴퓨터 마이크 혼선 점검).
      maxLevelRef.current = 0;
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ac = new AC();
        audioCtxRef.current = ac;
        const src = ac.createMediaStreamSource(stream);
        const an = ac.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        const buf = new Uint8Array(an.frequencyBinCount);
        const tick = () => {
          an.getByteTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i] - 128) / 128; if (v > peak) peak = v; }
          if (peak > maxLevelRef.current) maxLevelRef.current = peak;
          setLevel(peak);
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch { /* 레벨 미터 없이도 녹음은 진행 */ }
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((mm) => MediaRecorder.isTypeSupported?.(mm)) || "";
      const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const type = mr.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunksRef.current, { type });
        const silent = maxLevelRef.current < 0.03; // 거의 무음으로 녹음됨
        stopStream();
        setRecording(false);
        if (blob.size === 0) { setErr("녹음된 소리가 없어요. 마이크를 확인해 주세요."); return; }
        if (blob.size > MAX_BYTES) { setErr("녹음이 25MB를 넘었어요. 더 짧게 녹음하거나 나눠서 진행해 주세요."); return; }
        setFile(new File([blob], `회의녹음_${date}.${ext}`, { type }));
        if (silent) setErr("녹음 내내 소리가 거의 안 잡혔어요. 위에서 ‘이 컴퓨터 마이크’를 고르고(아이폰 아님) 다시 녹음해 주세요.");
        else setErr("");
      };
      mr.start();
      recRef.current = mr;
      setRecording(true);
      setRecSec(0);
      setFile(null);
      timerRef.current = setInterval(() => setRecSec((s) => s + 1), 1000);
    } catch {
      stopStream();
      setErr("마이크 권한이 필요해요. 브라우저에서 마이크 사용을 허용해 주세요.");
    }
  }
  function stopRec() { try { recRef.current?.stop(); } catch { /* ignore */ } }

  async function runSummary() {
    setErr("");
    if (tab === "audio" && !file) { setErr("녹음하거나 음성 파일을 선택해 주세요."); return; }
    if (tab === "text" && !text.trim()) { setErr("텍스트를 입력해 주세요."); return; }
    setBusy(true);
    setResult(null);
    try {
      const agendaText = hasContent(agenda) ? htmlToText(agenda) : "";
      const r = await meetingApi.transcribe(tab === "audio" ? { audio: file, agenda: agendaText } : { text: text.trim(), agenda: agendaText });
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI 요약에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  function attendeeNames(): string {
    const byId = new Map(staff.map((u) => [u.id, u.name]));
    return picked.map((s) => byId.get(s)).filter(Boolean).join(", ");
  }

  async function doSave(withSummary: boolean) {
    if (!title.trim() || !date) { setErr("제목과 날짜를 입력해 주세요."); return; }
    setSaving(true);
    try {
      await meetingApi.save({
        id,
        title: title.trim(),
        category,
        meetingDate: date,
        attendees: attendeeNames(),
        attendeeSubs: picked,
        agenda: hasContent(agenda) ? agenda : "",
        rawText: withSummary ? result?.rawText : (editing ? text : ""),
        summary: withSummary ? result?.summary : "",
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장에 실패했어요.");
      setSaving(false);
    }
  }

  if (!loaded) return <div className="mt"><div className="mt-loading">불러오는 중…</div></div>;

  return (
    <div className="mt">
      <div className="sm-head">
        <div>
          <button className="mt-back" onClick={onCancel}><Icon name="chev" /> 목록으로</button>
          <h1 className="sm-title">{editing ? "회의록 수정" : "새 회의록"}</h1>
        </div>
      </div>

      <div className="card mt-form">
        {/* 종류 */}
        <div className="mt-f">
          <span>회의 종류</span>
          <div className="mt-cat-pick">
            {categories.map((c) => (
              <button key={c} type="button" className={"mt-chip" + (category === c ? " on" : "")} onClick={() => setCategory(c)}>{c}</button>
            ))}
            {addingCat ? (
              <span className="mt-cat-add">
                <input className="input" autoFocus value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCategory()} placeholder="새 종류" />
                <button type="button" className="btn sm primary" onClick={addCategory}>추가</button>
              </span>
            ) : (
              <button type="button" className="mt-chip ghost" onClick={() => setAddingCat(true)}><Icon name="plus" /> 종류 추가</button>
            )}
          </div>
        </div>

        <label className="mt-f">
          <span>회의 제목 <i>*</i></span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 6월 정기 회의 / 호평중 김OO 학부모 상담" />
        </label>
        <label className="mt-f">
          <span>날짜 <i>*</i></span>
          <input className="input mt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <div className="mt-f">
          <span>참석자 <em className="mt-opt">선택 · 참석자는 이 회의를 열람할 수 있어요</em></span>
          {staff.length === 0 ? (
            <span className="mt-file">등록된 강사를 불러오는 중…</span>
          ) : (
            <div className="mt-att-chips">
              {staff.map((u) => (
                <button key={u.id} type="button" className={"mt-chip" + (picked.includes(u.id) ? " on" : "")} onClick={() => toggleAttendee(u.id)} aria-pressed={picked.includes(u.id)}>
                  {picked.includes(u.id) && <Icon name="check" />}
                  {u.name}
                  <span className="mt-chip-role">{ROLE_LABEL[u.role] || ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 회의안 (회의 전 미리 작성) */}
        <div className="mt-f">
          <span>회의안 <em className="mt-opt">회의 전 미리 작성 · 요약에도 반영돼요</em></span>
          <RichEditor value={agenda} onChange={setAgenda} placeholder="회의 전 안건·논의할 내용을 미리 적어두세요. 제목·형광펜·인용·콜아웃·이미지를 쓸 수 있어요." />
        </div>

        <div className="mt-save-foot">
          <button className="btn ghost" onClick={() => doSave(false)} disabled={saving}>{saving ? "저장 중…" : editing ? "변경사항 저장" : "회의안만 저장"}</button>
        </div>
      </div>

      {/* 회의 내용 → AI 요약 */}
      <div className="card mt-form">
        <div className="mt-block-h">회의 내용 → AI 요약</div>
        <div className="mt-tabs">
          <button className={"mt-tab" + (tab === "audio" ? " on" : "")} onClick={() => setTab("audio")}>녹음 · 음성 파일</button>
          <button className={"mt-tab" + (tab === "text" ? " on" : "")} onClick={() => setTab("text")}>텍스트 직접 입력</button>
        </div>

        {tab === "audio" ? (
          <div className="mt-audio">
            <input ref={fileRef} type="file" accept={ACCEPT} style={{ display: "none" }} onChange={(e) => pickFile(e.target.files?.[0])} />
            {!recording && mics.length > 0 && (
              <label className="mt-mic-row">
                <span>마이크</span>
                <select className="input mt-mic-sel" value={micId} onChange={(e) => setMicId(e.target.value)}>
                  <option value="">기본 마이크</option>
                  {mics.map((mm, i) => <option key={mm.deviceId || i} value={mm.deviceId}>{mm.label || `마이크 ${i + 1}`}</option>)}
                </select>
                <span className="mt-mic-hint">아이폰이 아니라 이 컴퓨터 마이크를 고르세요</span>
              </label>
            )}
            <div className="mt-audio-btns">
              {recording ? (
                <button className="btn mt-rec-stop" onClick={stopRec}><span className="mt-rec-dot" /> 녹음 중지 · {fmtSec(recSec)}</button>
              ) : (
                <button className="btn ghost" onClick={startRec} disabled={busy || saving}><span className="mt-mic" /> 여기서 녹음</button>
              )}
              <span className="mt-or">또는</span>
              <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={recording}><Icon name="minutes" /> 파일 선택</button>
            </div>
            {recording && (
              <div className="mt-level" title="입력 레벨 — 말할 때 막대가 움직여야 정상이에요">
                <div className="mt-level-bar" style={{ width: Math.min(100, Math.round(level * 140)) + "%" }} />
              </div>
            )}
            <span className="mt-file">{recording ? (level < 0.03 && recSec >= 2 ? "⚠ 소리가 안 잡혀요 — 마이크를 확인하세요(아이폰 아님)." : "녹음 중이에요… 말할 때 막대가 움직이는지 확인하세요.") : file ? file.name : "여기서 녹음하거나 파일을 올려주세요 (mp3·m4a·wav·ogg·webm · 최대 25MB)"}</span>
          </div>
        ) : (
          <textarea className="input mt-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="클로바 노트 등에서 변환된 텍스트를 여기에 붙여넣어 주세요." />
        )}

        <button className="btn mt-ai" onClick={runSummary} disabled={busy || saving}>
          <Icon name="sparkle" /> {busy ? "AI가 분석하고 있어요…" : "AI 요약 시작"}
        </button>
        {busy && <div className="mt-spin">AI가 내용을 분석하고 있어요… 잠시만 기다려주세요 (5~30초)</div>}
        {err && <div className="mt-err">{err}</div>}
      </div>

      {result && (
        <div className="mt-result-wrap">
          <h2 className="mt-result-h">AI 요약 결과</h2>
          <SummaryView summary={result.summary} />
          <div className="mt-save-foot">
            <button className="btn primary" onClick={() => doSave(true)} disabled={saving}>{saving ? "저장 중…" : "회의록 저장"}</button>
            <button className="btn ghost" onClick={runSummary} disabled={busy || saving}>다시 요약</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── 상세 ─────────────────────── */
function MeetingDetailView({ id, onBack, onEdit }: { id: number; onBack: () => void; onEdit: (id: number) => void }) {
  const [m, setM] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    let alive = true;
    meetingApi
      .get(id)
      .then((r) => { if (alive) { setM(r); setErr(""); } })
      .catch(() => { if (alive) setErr("불러오지 못했어요."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  async function remove() {
    if (!window.confirm("이 회의록을 삭제할까요?")) return;
    try { await meetingApi.remove(id); onBack(); }
    catch { setErr("삭제에 실패했어요."); }
  }

  if (loading) return <div className="mt"><div className="mt-loading">불러오는 중…</div></div>;
  if (err || !m) return <div className="mt"><div className="mt-err">{err || "회의록을 찾을 수 없어요."}</div></div>;

  const agendaHtml = m.agenda ? sanitizeHtml(m.agenda) : "";

  return (
    <div className="mt">
      <div className="sm-head">
        <div>
          <button className="mt-back" onClick={onBack}><Icon name="chev" /> 목록으로</button>
          <div className="mt-card-titrow">
            {m.category && <span className="mt-cat">{m.category}</span>}
            <h1 className="sm-title">{m.title}</h1>
          </div>
          <p className="sm-desc">{m.meetingDate}{m.attendees ? ` · ${m.attendees}` : ""}{m.createdBy ? ` · 기록 ${m.createdBy}` : ""}</p>
        </div>
        <div className="mt-detail-actions">
          <button className="btn ghost" onClick={() => onEdit(id)}><Icon name="edit" /> 수정</button>
          <button className="btn ghost danger" onClick={remove}><Icon name="trash" /> 삭제</button>
        </div>
      </div>

      {agendaHtml && (
        <section className="mt-section">
          <h2 className="mt-result-h">회의안</h2>
          <div className="mt-rich card" dangerouslySetInnerHTML={{ __html: agendaHtml }} />
        </section>
      )}

      {m.summary ? (
        <section className="mt-section">
          <h2 className="mt-result-h">AI 요약</h2>
          <SummaryView summary={m.summary} />
          <MeetingActionItems meeting={m} />
        </section>
      ) : (
        <div className="mt-plan-cta card">
          <span>아직 회의 요약이 없어요. 회의가 끝나면 녹음·텍스트로 요약을 추가할 수 있어요.</span>
          <button className="btn primary sm" onClick={() => onEdit(id)}>회의 내용 추가·요약하기</button>
        </div>
      )}

      {m.rawText && (
        <div className="mt-raw card">
          <button className="mt-raw-toggle" onClick={() => setShowRaw((v) => !v)} aria-expanded={showRaw}>
            <span className={"nav-caret" + (showRaw ? "" : " closed")}>▾</span> 원본 전문 보기
          </button>
          {showRaw && <pre className="mt-raw-body">{m.rawText}</pre>}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── 액션 아이템 → 강사 업무 배정 ───────────────────────
   요약의 '할일 목록'을 항목으로 뽑아, 각각 강사 업무 보드로 배정(자세히 팝업)하거나 그냥 둔다. */
function extractActionItems(summary: string): string[] {
  const secs = parseSummary(summary);
  const sec = secs.find((s) => /할\s*일|액션|to.?do/i.test(s.heading));
  const items = (sec ? sec.bullets : []).map((b) => b.trim());
  return items.filter((t) => t && !/^해당\s*없음/.test(t));
}

function MeetingActionItems({ meeting }: { meeting: MeetingDetail }) {
  const { user } = useAuth();
  const items = useMemo(() => extractActionItems(meeting.summary), [meeting.summary]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [assignTask, setAssignTask] = useState<BoardTaskDraft | null>(null);
  const [assignedIdx, setAssignedIdx] = useState<Set<number>>(new Set());
  useEffect(() => {
    let alive = true;
    listUsers().then((u) => { if (alive) setUsers(u.filter((x) => x.role !== "student")); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (items.length === 0) return null;

  function openAssign(text: string, idx: number) {
    // 담당자 후보 — 할일 앞 [이름] 표기가 있으면 미리 담당자로.
    const m = /^\[([^\]]+)\]\s*(.*)$/.exec(text);
    const who = m ? m[1].trim() : "";
    const title = m ? m[2].trim() : text;
    const matched = users.find((u) => u.name === who);
    const draft = blankTask(title, {
      requester: user?.name || "",
      assignee: matched ? matched.name : "",
      memo: `회의록: ${meeting.title}${meeting.meetingDate ? ` (${meeting.meetingDate})` : ""}`,
    });
    setAssignTask({ draft, idx });
  }
  async function save(next: BoardTask) {
    try {
      await tasksApi.save(next);
      if (assignTask) setAssignedIdx((cur) => new Set(cur).add(assignTask.idx));
      setAssignTask(null);
    } catch { /* ignore */ }
  }

  return (
    <div className="mt-actions card">
      <div className="mt-actions-h">액션 아이템 <span className="mt-actions-sub">필요한 일은 강사 업무로 배정하세요</span></div>
      <ul className="mt-actions-list">
        {items.map((t, i) => (
          <li key={i} className="mt-action-row">
            <span className="mt-action-t">{t}</span>
            {assignedIdx.has(i) ? (
              <span className="mt-action-done"><Icon name="check" /> 배정됨</span>
            ) : (
              <button className="btn ghost sm" onClick={() => openAssign(t, i)}>강사 업무로 배정</button>
            )}
          </li>
        ))}
      </ul>
      {assignTask && (
        <TaskModal
          task={assignTask.draft}
          users={users}
          isAdmin={user?.role === "admin"}
          heading="강사 업무로 배정 (자세히)"
          saveLabel="업무 보드로 보내기"
          onClose={() => setAssignTask(null)}
          onSave={save}
        />
      )}
    </div>
  );
}
interface BoardTaskDraft { draft: BoardTask; idx: number }

/* ─────────────────────── 요약 렌더 ─────────────────────── */
function SummaryView({ summary }: { summary: string }) {
  const sections = useMemo(() => parseSummary(summary), [summary]);
  if (!sections.length) return <div className="mt-summary card"><p className="muted">요약 내용이 없어요.</p></div>;
  return (
    <div className="mt-summary card">
      {sections.map((s, i) => (
        <section key={i} className="mt-sec">
          {s.heading && <h3 className="mt-sec-h">{s.heading}</h3>}
          {s.bullets.length > 0 && (
            <ul className="mt-bullets">{s.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>
          )}
          {s.lines.map((ln, j) => <p key={"p" + j} className="mt-line">{ln}</p>)}
        </section>
      ))}
    </div>
  );
}

interface Section { heading: string; bullets: string[]; lines: string[] }
function parseSummary(text: string): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  const push = () => { if (cur && (cur.heading || cur.bullets.length || cur.lines.length)) out.push(cur); };
  for (const raw of (text || "").replace(/\r/g, "").split("\n")) {
    const ln = raw.trim();
    if (!ln || ln === "---") continue;
    const h = /^#{1,6}\s+(.*)$/.exec(ln);
    if (h) { push(); cur = { heading: h[1].trim(), bullets: [], lines: [] }; continue; }
    if (!cur) cur = { heading: "", bullets: [], lines: [] };
    const b = /^[-*]\s+(.*)$/.exec(ln);
    if (b) cur.bullets.push(b[1].trim());
    else cur.lines.push(ln);
  }
  push();
  return out;
}
