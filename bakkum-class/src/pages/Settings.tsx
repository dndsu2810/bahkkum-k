import { useEffect, useRef, useState } from "react";
import { TONES, type Category, type Tone } from "../lib/categories";
import { getConfig, setConfig, getSecretSet, uploadImage } from "../lib/configApi";
import { feedbackApi, type Notice } from "../lib/feedbackApi";
import { NOTICE_AUDIENCES, audienceLabel, type NoticeAudience } from "../lib/notice";
import { syncAllFromNotion, type SyncStep } from "../lib/syncAll";
import { Icon } from "../icons";

/** 학원 로고 업로드 — 사이드바 "바" 자리에 쓰임(원장). 없으면 기본 박스 유지. */
const DEFAULT_LOGO_SIZE = 38;
function LogoSetting() {
  const [logo, setLogo] = useState("");
  const [size, setSize] = useState(DEFAULT_LOGO_SIZE);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    getConfig().then((c) => { setLogo(c.logoUrl || ""); setSize(Number(c.logoSize) || DEFAULT_LOGO_SIZE); }).catch(() => {});
  }, []);

  async function onPick(file?: File | null) {
    if (!file || busy) return;
    setBusy(true); setMsg("");
    try {
      const url = await uploadImage(file);
      await setConfig({ logoUrl: url });
      setLogo(url);
      setMsg("로고를 저장했어요. 새로고침하면 사이드바에 보여요.");
    } catch { setMsg("업로드 실패"); } finally { setBusy(false); }
  }
  async function clearLogo() {
    if (busy) return;
    setBusy(true);
    try { await setConfig({ logoUrl: "" }); setLogo(""); setMsg("기본 로고로 되돌렸어요."); }
    catch { setMsg("실패"); } finally { setBusy(false); }
  }
  // 크기 변경은 슬라이더 조작 중엔 미리보기만, 멈추면(디바운스) 저장.
  function onSize(v: number) {
    setSize(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void setConfig({ logoSize: String(v) }).then(() => setMsg("로고 크기를 저장했어요. 새로고침하면 적용돼요.")).catch(() => {}); }, 500);
  }

  return (
    <div className="card sec-gap" style={{ padding: 16, marginTop: 14 }}>
      <div className="card-title" style={{ marginBottom: 6 }}>학원 로고</div>
      <div className="page-desc" style={{ marginBottom: 12 }}>사이드바 좌상단 “바” 자리에 들어갈 로고예요. 정사각형 이미지가 가장 보기 좋아요(없으면 기본 “바” 박스).</div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ width: 72, height: 72, display: "grid", placeItems: "center", border: "1px dashed var(--line)", borderRadius: 12 }}>
          {logo ? <img src={logo} alt="로고" style={{ width: size, height: size, borderRadius: Math.round(size * 0.26), objectFit: "cover" }} /> : <div className="logo" style={{ width: size, height: size }}>바</div>}
        </div>
        <label className="btn ghost">
          {busy ? "올리는 중…" : "로고 업로드"}
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onPick(e.target.files?.[0])} disabled={busy} />
        </label>
        {logo && <button className="btn ghost" onClick={clearLogo} disabled={busy}>기본으로</button>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, maxWidth: 360 }}>
        <span className="page-desc" style={{ whiteSpace: "nowrap" }}>로고 크기</span>
        <input type="range" min={24} max={72} step={1} value={size} onChange={(e) => onSize(Number(e.target.value))} style={{ flex: 1 }} />
        <span className="page-desc" style={{ minWidth: 42, textAlign: "right" }}>{size}px</span>
      </div>
      {msg && <div className="page-desc" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  );
}

/* 노션에서 가져오기 UI는 제거됨(2026-06-18) — 실수 클릭으로 데이터가 노션 기준으로
 * 덮어써지는 사고를 막기 위해. 가져오기 기능(api.ts importRecords, lib/syncAll)은
 * 남겨둬 필요 시 수동으로만 사용. 관련 백엔드: worker/index.ts importRecords. */

/** 공지 배너 — 원장이 강사에게 띄우는 상단 띠. 있을 때만 노출. */
function NoticeSetting() {
  const [list, setList] = useState<Notice[]>([]);
  const [text, setText] = useState("");
  const [level, setLevel] = useState<"info" | "warn">("info");
  const [audience, setAudience] = useState<NoticeAudience>("staff");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      setList(await feedbackApi.noticesAll());
    } catch {
      /* ignore */
    }
  }
  useEffect(() => { void reload(); }, []);

  async function post() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await feedbackApi.saveNotice({ text: text.trim(), level, audience, active: true });
      setText("");
      await reload();
    } finally {
      setBusy(false);
    }
  }
  async function toggle(n: Notice) {
    await feedbackApi.saveNotice({ id: n.id, text: n.text, level: n.level, audience: n.audience, active: !n.active });
    await reload();
  }
  async function remove(n: Notice) {
    await feedbackApi.removeNotice(n.id);
    await reload();
  }

  return (
    <div className="card sec-gap" style={{ padding: 16, marginTop: 14 }}>
      <div className="card-title" style={{ marginBottom: 6 }}>공지 배너</div>
      <div className="page-desc" style={{ marginBottom: 12 }}>대상을 골라 그 사람들 화면 상단에 한 줄로 띄워요(전체·강사만·학생 전체·초등영어·중고등영어). 끄거나 지우면 사라집니다.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" style={{ flex: 1, minWidth: 200 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="공지 문구 (예: 오늘 6시 회의 있어요)" onKeyDown={(e) => e.key === "Enter" && post()} />
        <select className="input" style={{ width: 150 }} value={audience} onChange={(e) => setAudience(e.target.value as NoticeAudience)}>
          {NOTICE_AUDIENCES.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
        </select>
        <select className="input" style={{ width: 100 }} value={level} onChange={(e) => setLevel(e.target.value as "info" | "warn")}>
          <option value="info">공지(파랑)</option>
          <option value="warn">중요(주황)</option>
        </select>
        <button className="btn primary" onClick={post} disabled={!text.trim() || busy}>게시</button>
      </div>
      {list.length > 0 && (
        <div className="rep-list" style={{ marginTop: 12 }}>
          {list.map((n) => (
            <div className="rep-itemrow" key={n.id}>
              <span className={"notice-dot " + (n.level === "warn" ? "warn" : "info")} />
              <span style={{ flex: 1, minWidth: 140, opacity: n.active ? 1 : 0.5 }}>{n.text}</span>
              <span className={"badge " + (n.audience === "all" ? "b-blue" : n.audience === "staff" ? "b-gray" : "b-purple")}>{audienceLabel(n.audience)}</span>
              <button className="btn ghost sm" onClick={() => toggle(n)}>{n.active ? "내리기" : "올리기"}</button>
              <button className="rep-x" onClick={() => remove(n)} title="삭제"><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 오류 요청 알림용 카카오워크 웹훅 URL(노출 안 됨, 설정 여부만 표시). */
function KakaoWebhookSetting() {
  const [set, setSet] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function reload() {
    try {
      const s = await getSecretSet();
      setSet(s.includes("secret_kakao_webhook"));
    } catch {
      /* ignore */
    }
  }
  useEffect(() => { void reload(); }, []);

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      await setConfig({ secret_kakao_webhook: url.trim() });
      setUrl("");
      setMsg(url.trim() ? "저장됐어요 ✓" : "비웠어요");
      await reload();
    } catch {
      setMsg("저장에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card sec-gap" style={{ padding: 16, marginTop: 14 }}>
      <div className="card-title" style={{ marginBottom: 6 }}>오류 요청 알림 (카카오워크 웹훅)</div>
      <div className="page-desc" style={{ marginBottom: 12 }}>
        오류·개선 요청이 등록되면 이 웹훅으로 알림이 가요. {set ? <b style={{ color: "var(--ok)" }}>설정됨 ✓</b> : <b style={{ color: "var(--ink3)" }}>아직 미설정</b>} (값은 보안상 표시되지 않아요.)
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" style={{ flex: 1, minWidth: 240 }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={set ? "새 URL로 교체하려면 붙여넣기 (비우면 끔)" : "카카오워크 Incoming Webhook URL"} />
        <button className="btn" onClick={save} disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
      </div>
      {msg && <div className="page-desc" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  );
}

export function Settings({
  categories,
  onCategoriesChange,
}: {
  categories: Category[];
  onCategoriesChange: (c: Category[]) => void;
}) {
  function editCat(i: number, patch: Partial<Category>) {
    onCategoriesChange(categories.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }
  function addCat() {
    const used = new Set(categories.map((c) => c.tone));
    const tone = (TONES.find((t) => !used.has(t)) || "blue") as Tone;
    onCategoriesChange([...categories, { name: "새 구분", tone }]);
  }
  function removeCat(i: number) {
    if (categories.length <= 1) return;
    onCategoriesChange(categories.filter((_, j) => j !== i));
  }
  function moveCat(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= categories.length) return;
    const arr = categories.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onCategoriesChange(arr);
  }

  return (
    <section className="page active">
      <div className="page-head">
        <div>
          <h1 className="page-title">설정</h1>
          <div className="page-desc">수업 구분(카테고리)과 데이터 관리. 강사 계정은 ‘강사 관리’ 메뉴에서.</div>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="card-title" style={{ marginBottom: 10 }}>수업 구분(카테고리)</div>
        <div className="rep-list">
          {categories.map((c, i) => (
            <div className="rep-itemrow" key={i}>
              <span className={"av av-" + c.tone}>{c.name.slice(0, 2) || "?"}</span>
              <input
                className="input"
                style={{ flex: 1, minWidth: 140 }}
                value={c.name}
                onChange={(e) => editCat(i, { name: e.target.value })}
                placeholder="구분 이름 (예: 초등수학)"
              />
              <select className="input" style={{ width: 110 }} value={c.tone} onChange={(e) => editCat(i, { tone: e.target.value as Tone })}>
                {TONES.map((t) => (
                  <option key={t} value={t}>
                    {t === "blue" ? "파랑" : t === "purple" ? "보라" : t === "pink" ? "핑크" : t === "green" ? "초록" : "주황"}
                  </option>
                ))}
              </select>
              <button className="rep-x" onClick={() => moveCat(i, -1)} disabled={i === 0} title="위로" style={{ transform: "rotate(180deg)" }}>
                <Icon name="chev" />
              </button>
              <button className="rep-x" onClick={() => moveCat(i, 1)} disabled={i === categories.length - 1} title="아래로">
                <Icon name="chev" />
              </button>
              <button className="rep-x" onClick={() => removeCat(i)} disabled={categories.length <= 1} title="삭제">
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
        <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={addCat}>
          <Icon name="plus" />
          구분 추가
        </button>
        <div className="page-desc" style={{ marginTop: 10 }}>
          구분을 바꿔도 기존 학생의 구분은 유지됩니다. 학생별 구분은 ‘학생 관리’에서 바꿔주세요.
          대시보드·시간표·리포트 색상이 여기 설정을 따릅니다.
        </div>
      </div>

      <NoticeSetting />
      <CheckoutNoticeSetting />
      <KakaoWebhookSetting />
      <LogoSetting />
      <EngImportSetting />
    </section>
  );
}

/* 하원 안내 문구 — 강사가 '하원' 누르면 학생 화면 상단 배너에 뜨는 문구(원장만 수정). */
function CheckoutNoticeSetting() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { getConfig().then((c) => setText(c.checkout_notice || "")).catch(() => {}); }, []);
  async function save() {
    setBusy(true);
    try { await setConfig({ checkout_notice: text.trim() }); setMsg("저장했어요. 다음 하원부터 적용돼요."); }
    catch { setMsg("저장하지 못했어요."); }
    finally { setBusy(false); }
  }
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="card-title" style={{ marginBottom: 6 }}>하원 안내 문구</div>
      <div className="page-desc" style={{ marginBottom: 12 }}>강사가 ‘하원’을 누르면 학생 화면 상단에 뜨는 문구예요. 비우면 기본값(하원하세요! Good Bye!).</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" style={{ flex: 1, minWidth: 220 }} value={text} maxLength={100} onChange={(e) => setText(e.target.value)} placeholder="하원하세요! Good Bye!" onKeyDown={(e) => e.key === "Enter" && save()} />
        <button className="btn primary" onClick={save} disabled={busy}>저장</button>
      </div>
      {msg && <div className="page-desc" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

/* 초등영어 노션 가져오기 — 초등 수업일지만(추가·갱신, 삭제 없음·멱등).
 * 전체 노션 가져오기 UI는 2026-06-18 제거됨(실수 덮어쓰기 방지). 이건 초등 수업일지만 노출. */
function EngImportSetting() {
  const [steps, setSteps] = useState<SyncStep[]>([]);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (busy) return;
    if (!window.confirm("노션에서 초등영어 수업일지를 가져올까요?\n이름·날짜로 맞춰 추가·갱신만 해요(삭제 없음). 여러 번 눌러도 안전해요.")) return;
    setBusy(true);
    try {
      await syncAllFromNotion((s) => setSteps(s), ["elemLog"]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card sec-gap" style={{ padding: 16, marginTop: 14 }}>
      <div className="card-title" style={{ marginBottom: 6 }}>초등영어 노션 가져오기</div>
      <div className="page-desc" style={{ marginBottom: 12 }}>
        노션의 <b>초등 수업일지</b>를 앱으로 가져와요(진도·단어시험·체크·출석). 이름·날짜로 맞춰 추가·갱신만 하고(삭제 없음), 여러 번 눌러도 안전해요. 중고등 영어는 건드리지 않아요. 원장 전용.
      </div>
      <button className="btn primary" onClick={run} disabled={busy}>
        {busy ? "가져오는 중…" : "초등영어 수업일지 가져오기"}
      </button>
      {steps.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {steps.map((s) => (
            <div key={s.key} className="page-desc">
              {s.label}: {s.status === "running" ? "가져오는 중…" : s.status === "done" ? `${s.count}건 반영` : s.status === "error" ? `실패 (${s.error || ""})` : "대기"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
