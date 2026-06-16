import { useEffect, useState } from "react";
import { engApi } from "../lib/engApi";
import { useAuth } from "../auth";

type Row = { name: string; value: number };

/** 사유 라벨("출석 100")을 표시이름+점수로 분리. */
function splitLabel(name: string, value: number): Row {
  const m = /^(.*?)\s*(-?\d+)\s*$/.exec(name);
  if (m && m[1].trim()) return { name: m[1].trim(), value: Number(m[2]) };
  return { name: name.replace(/\s*-?\d+\s*$/, "").trim() || name, value };
}

/** 포인트 항목(적립·차감 사유) 공통 관리 — 원장·강사가 직접 목록과 점수를 작성. 영어 일일기록 버튼에 그대로 반영. */
export function PointCatalog() {
  const { user } = useAuth();
  const canEdit = user?.role !== "student";
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    engApi.pointReasons()
      .then((rs) => { setRows(rs.map((r) => splitLabel(r.name, r.value))); setLoaded(true); })
      .catch(() => { setErr("불러오지 못했어요. 잠시 후 다시 시도해 주세요."); setLoaded(true); });
  }, []);

  function update(i: number, patch: Partial<Row>) { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); setSaved(false); }
  function add() { setRows((rs) => [...rs, { name: "", value: 0 }]); setSaved(false); }
  function remove(i: number) { setRows((rs) => rs.filter((_, j) => j !== i)); setSaved(false); }

  async function save() {
    const payload = rows.filter((r) => r.name.trim()).map((r) => ({ name: `${r.name.trim()} ${r.value}`, value: r.value }));
    try { await engApi.savePointReasons(payload); setSaved(true); setErr(""); }
    catch { setErr("저장에 실패했어요."); }
  }

  return (
    <div className="sm-wrap">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">포인트 항목</h1>
          <p className="sm-desc">적립·차감 사유와 점수를 직접 작성하세요. 여기서 만든 항목이 수업 기록의 포인트 버튼으로 그대로 나옵니다.</p>
        </div>
        {canEdit && (
          <button className="btn primary" onClick={save} disabled={saved}>{saved ? "저장됨" : "저장"}</button>
        )}
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}

      <div className="card" style={{ padding: 14 }}>
        <div className="pc-legend">적립은 <b className="pc-plus">+점수</b>, 차감은 <b className="pc-minus">-점수</b>로 입력하세요. (예: 출석 100, 지각 -100)</div>
        {!loaded ? (
          <div className="hub-muted">불러오는 중…</div>
        ) : (
          <div className="pc-rows">
            {rows.map((r, i) => (
              <div className={"pc-row" + (r.value < 0 ? " minus" : r.value > 0 ? " plus" : "")} key={i}>
                <input className="input pc-name" value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="사유 (예: 출석·칭찬·숙제완료)" disabled={!canEdit} />
                <input className="input pc-val" type="number" step={10} value={r.value} onChange={(e) => update(i, { value: Math.round(Number(e.target.value)) || 0 })} disabled={!canEdit} />
                <span className="pc-unit">점</span>
                {canEdit && <button className="btn ghost sm" onClick={() => remove(i)} aria-label="삭제">✕</button>}
              </div>
            ))}
            {rows.length === 0 && <div className="hub-muted">항목이 없어요. 아래 ‘+ 항목 추가’로 만들어 보세요.</div>}
          </div>
        )}
        {canEdit && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn ghost" onClick={add}>+ 항목 추가</button>
            <button className="btn primary" onClick={save} disabled={saved} style={{ marginLeft: "auto" }}>{saved ? "저장됨" : "저장"}</button>
          </div>
        )}
      </div>

      <p className="hub-muted" style={{ marginTop: 12, fontSize: "var(--t-cap)" }}>
        ※ 보강 수업은 어떤 사유를 골라도 포인트가 적립되지 않습니다(출결만 기록). 수학·영어 포인트 일원화는 이 목록을 기준으로 진행됩니다.
      </p>
    </div>
  );
}
