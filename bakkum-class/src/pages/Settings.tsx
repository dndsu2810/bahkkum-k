import { useState } from "react";
import { ALWAYS, fullOrdered, type NavPrefs, type PageId } from "../lib/nav";
import { TONES, type Category, type Tone } from "../lib/categories";
import { SECTION_LABELS, type SectionKey } from "../lib/reportSections";
import { useStore } from "../store";
import { importRecords } from "../api";
import { Icon } from "../icons";

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
  navPrefs,
  onChange,
  categories,
  onCategoriesChange,
  reportOrder,
  onReportOrderChange,
}: {
  navPrefs: NavPrefs;
  onChange: (p: NavPrefs) => void;
  categories: Category[];
  onCategoriesChange: (c: Category[]) => void;
  reportOrder: SectionKey[];
  onReportOrderChange: (o: SectionKey[]) => void;
}) {
  function moveSec(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= reportOrder.length) return;
    const arr = reportOrder.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onReportOrderChange(arr);
  }
  const items = fullOrdered(navPrefs);
  const ids = items.map((x) => x.id);

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    const arr = ids.slice();
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange({ ...navPrefs, order: arr });
  }
  function toggleHide(id: PageId) {
    const hidden = new Set(navPrefs.hidden);
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    onChange({ ...navPrefs, hidden: [...hidden] });
  }

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
          <div className="page-title">설정</div>
          <div className="page-desc">사이드바 메뉴 순서와 표시 여부를 조정합니다. (이 기기에 저장)</div>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div className="card-title" style={{ marginBottom: 10 }}>메뉴 순서 · 표시</div>
        <div className="rep-list">
          {items.map((n, i) => {
            const locked = ALWAYS.includes(n.id);
            const hidden = navPrefs.hidden.includes(n.id) && !locked;
            return (
              <div className="rep-srow" key={n.id} style={hidden ? { opacity: 0.5 } : undefined}>
                <span className="nm">{n.label}</span>
                {locked && <span className="badge b-gray">고정</span>}
                <span className="att" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button className="rep-x" onClick={() => move(i, -1)} disabled={i === 0} title="위로" style={{ transform: "rotate(180deg)" }}>
                    <Icon name="chev" />
                  </button>
                  <button className="rep-x" onClick={() => move(i, 1)} disabled={i === ids.length - 1} title="아래로">
                    <Icon name="chev" />
                  </button>
                  {!locked && (
                    <button className="btn ghost sm" onClick={() => toggleHide(n.id)}>
                      {hidden ? "표시" : "숨기기"}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <div className="page-desc" style={{ marginTop: 10 }}>
          위/아래 화살표로 순서를, ‘숨기기’로 사이드바에서 감춥니다. ‘오늘·설정’은 항상 표시됩니다.
        </div>
      </div>

      <div className="card sec-gap" style={{ padding: 16, marginTop: 14 }}>
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

      <div className="card sec-gap" style={{ padding: 16, marginTop: 14 }}>
        <div className="card-title" style={{ marginBottom: 10 }}>월말리포트 섹션 순서</div>
        <div className="rep-list">
          {reportOrder.map((k, i) => (
            <div className="rep-srow" key={k}>
              <span className="nm">{SECTION_LABELS[k]}</span>
              <span className="att" style={{ display: "flex", gap: 6 }}>
                <button className="rep-x" onClick={() => moveSec(i, -1)} disabled={i === 0} title="위로" style={{ transform: "rotate(180deg)" }}>
                  <Icon name="chev" />
                </button>
                <button className="rep-x" onClick={() => moveSec(i, 1)} disabled={i === reportOrder.length - 1} title="아래로">
                  <Icon name="chev" />
                </button>
              </span>
            </div>
          ))}
        </div>
        <div className="page-desc" style={{ marginTop: 10 }}>
          미리보기/저장되는 리포트의 섹션 표시 순서입니다. (내용이 있는 섹션만 번호가 매겨져 표시됩니다)
        </div>
      </div>

      <OneTimeImport />
    </section>
  );
}
