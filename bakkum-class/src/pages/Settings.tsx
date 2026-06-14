import { useEffect, useState } from "react";
import { TONES, type Category, type Tone } from "../lib/categories";
import { useStore } from "../store";
import { importRecords } from "../api";
import { getConfig, setConfig, uploadImage } from "../lib/configApi";
import { Icon } from "../icons";

/** 학원 로고 업로드 — 사이드바 "바" 자리에 쓰임(원장). 없으면 기본 박스 유지. */
function LogoSetting() {
  const [logo, setLogo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { getConfig().then((c) => setLogo(c.logoUrl || "")).catch(() => {}); }, []);

  async function onPick(file?: File | null) {
    if (!file || busy) return;
    setBusy(true); setMsg("");
    try {
      const url = await uploadImage(file);
      await setConfig({ logoUrl: url });
      setLogo(url);
      setMsg("로고를 저장했어요. 새로고침하면 사이드바에 반영됩니다.");
    } catch { setMsg("업로드 실패"); } finally { setBusy(false); }
  }
  async function clearLogo() {
    if (busy) return;
    setBusy(true);
    try { await setConfig({ logoUrl: "" }); setLogo(""); setMsg("기본 로고로 되돌렸어요."); }
    catch { setMsg("실패"); } finally { setBusy(false); }
  }

  return (
    <div className="card sec-gap" style={{ padding: 16, marginTop: 14 }}>
      <div className="card-title" style={{ marginBottom: 6 }}>학원 로고</div>
      <div className="page-desc" style={{ marginBottom: 12 }}>사이드바 좌상단 “바” 자리에 들어갈 로고예요. 정사각형 이미지가 가장 보기 좋아요(없으면 기본 “바” 박스).</div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        {logo ? <img src={logo} alt="로고" style={{ width: 48, height: 48, borderRadius: 12, objectFit: "cover", border: "1px solid var(--line)" }} /> : <div className="logo">바</div>}
        <label className="btn ghost">
          {busy ? "올리는 중…" : "로고 업로드"}
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onPick(e.target.files?.[0])} disabled={busy} />
        </label>
        {logo && <button className="btn ghost" onClick={clearLogo} disabled={busy}>기본으로</button>}
      </div>
      {msg && <div className="page-desc" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  );
}

/** 최초 1회용 — 예전에 노션에 쌓아둔 기록(출결/숙제/진도/테스트)을 앱으로 한 번 옮긴다.
 *  평소엔 쓰지 않음(앱이 기록의 원본). 설정 안에 숨겨 둔다. */
function OneTimeImport() {
  const { reload, toast } = useStore();
  const [importing, setImporting] = useState(false);

  async function onImport() {
    if (importing) return;
    if (!window.confirm("예전에 노션에 쌓아둔 기록을 앱으로 가져옵니다.\n평소엔 쓰지 않는 최초 1회용 기능이에요. 진행할까요?")) return;
    setImporting(true);
    try {
      const r = await importRecords();
      if (r.error) toast("가져오기 실패: " + r.error);
      else {
        await reload();
        toast(`노션 기록 가져오기 완료 · 출결 ${r.attendance} · 숙제 ${r.homework} · 진도 ${r.progress} · 테스트 ${r.test}건`);
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="card sec-gap" style={{ padding: 16, marginTop: 14 }}>
      <div className="card-title" style={{ marginBottom: 6 }}>노션 기록 1회 가져오기 (최초 1회용)</div>
      <div className="page-desc" style={{ marginBottom: 12 }}>
        평소에는 필요 없습니다. 기록(출결·숙제·진도·테스트)은 이 앱이 원본이고 노션으로 자동 저장됩니다.
        예전에 노션에 쌓아둔 기록을 앱으로 처음 한 번만 옮길 때 사용하세요.
      </div>
      <button className="btn" onClick={onImport} disabled={importing}>
        <span className={importing ? "spin" : undefined}>
          <Icon name="refresh" />
        </span>
        {importing ? "가져오는 중…" : "노션 기록 가져오기"}
      </button>
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

      <LogoSetting />
      <OneTimeImport />
    </section>
  );
}
