import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { engApi, type EngRanking } from "../lib/engApi";
import { SkeletonList } from "../components/Skeleton";
import { HexAvatar, HoneyDrop, Crown, EmptyHive } from "../soez";

/** 사유 라벨("출석 100")을 표시이름+점수로 분리. */
type PItem = { name: string; value: number };
function splitLabel(name: string, value: number): PItem {
  const m = /^(.*?)\s*(-?\d+)\s*$/.exec(name);
  if (m && m[1].trim()) return { name: m[1].trim(), value: Number(m[2]) };
  return { name: name.replace(/\s*-?\d+\s*$/, "").trim() || name, value };
}

/** 포인트 항목(점수표) — 칩으로 보여주고, 칩을 눌러 바로 수정. 강사·원장만 편집(학생은 안 보임).
 *  예전 '포인트 항목' 화면을 랭킹 안으로 합쳤어요. 저장하면 수업기록 포인트 버튼에 그대로 반영돼요. */
function PointItems() {
  const [rows, setRows] = useState<PItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(true);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    engApi.pointReasons()
      .then((rs) => { setRows(rs.map((r) => splitLabel(r.name, r.value))); setLoaded(true); })
      .catch(() => { setErr("불러오지 못했어요."); setLoaded(true); });
  }, []);

  function update(i: number, patch: Partial<PItem>) { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); setSaved(false); }
  function add() { setRows((rs) => { setEditIdx(rs.length); return [...rs, { name: "", value: 0 }]; }); setSaved(false); }
  function remove(i: number) { setRows((rs) => rs.filter((_, j) => j !== i)); setSaved(false); setEditIdx(null); }
  async function save() {
    const payload = rows.filter((r) => r.name.trim()).map((r) => ({ name: `${r.name.trim()} ${r.value}`, value: r.value }));
    try { await engApi.savePointReasons(payload); setSaved(true); setEditIdx(null); setErr(""); }
    catch { setErr("저장에 실패했어요."); }
  }

  return (
    <div className="card pitems">
      <div className="pitems-head">
        <div>
          <h2 className="pitems-title">포인트 항목 (점수표)</h2>
          <p className="pitems-desc">칩을 눌러 사유·점수를 고쳐요. 적립은 +점수, 차감은 −점수. 여기서 만든 항목이 수업기록 포인트 버튼으로 나와요.</p>
        </div>
        {!saved && <button className="btn primary sm" onClick={save}>저장</button>}
      </div>
      {err && <div className="auth-err" style={{ margin: "6px 0" }}>{err}</div>}
      {!loaded ? (
        <div className="hub-muted">불러오는 중…</div>
      ) : (
        <div className="pchip-wrap">
          {rows.map((r, i) => editIdx === i ? (
            <div className="pchip editing" key={i}>
              <input className="pchip-name" value={r.name} autoFocus onChange={(e) => update(i, { name: e.target.value })} placeholder="사유" />
              <input className="pchip-val" type="number" step={10} value={r.value} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => update(i, { value: Math.round(Number(e.target.value)) || 0 })} />
              <span className="pchip-unit">점</span>
              <button className="pchip-del" onClick={() => remove(i)} title="삭제">✕</button>
              <button className="pchip-done" onClick={() => setEditIdx(null)} title="완료">✓</button>
            </div>
          ) : (
            <button key={i} className={"pchip" + (r.value < 0 ? " minus" : r.value > 0 ? " plus" : "")} onClick={() => setEditIdx(i)}>
              <span className="pchip-t">{r.name || "(이름 없음)"}</span>
              <b>{r.value > 0 ? `+${r.value}` : r.value}</b>
            </button>
          ))}
          <button className="pchip add" onClick={add}>+ 항목</button>
        </div>
      )}
    </div>
  );
}

/** 학생 포인트 랭킹 — 영어 수업기록 포인트(적립−차감) 누적 합 순위. 공통. */
export function PointRanking() {
  const { user } = useAuth();
  // 시상('적립완료')·점수표 편집은 강사·원장만. 데스크·학생은 보기만.
  const canAward = !!user && ["admin", "math", "english_mid", "english_elem"].includes(user.role);
  const [list, setList] = useState<EngRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(""); // 적립완료 처리 중인 studentId

  function load() {
    engApi
      .ranking()
      .then((r) => { setList(r); setLoading(false); })
      .catch(() => { setErr("불러오지 못했어요. 잠시 후 다시 시도해 주세요."); setLoading(false); });
  }
  useEffect(() => { load(); }, []);

  async function award(r: EngRanking) {
    if (busy) return;
    if (!window.confirm(`${r.name} 학생을 시상(적립완료) 처리할까요?\n\n모은 꿀 ${r.points.toLocaleString()}이 0으로 초기화되고, 다음 순위부터 다시 쌓여요. (기록은 남아요)`)) return;
    setBusy(r.studentId);
    setErr("");
    try {
      await engApi.redeemRanking(r.studentId);
      load();
    } catch {
      setErr("적립완료 처리에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy("");
    }
  }

  const ranked = list.filter((r) => r.points !== 0 || r.days > 0);

  return (
    <div className="sm-wrap">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">포인트 랭킹</h1>
          <p className="sm-desc">출석·숙제·칭찬으로 모은 꿀(포인트) 순위예요.</p>
        </div>
        <div className="sm-count">{ranked.length}명</div>
      </div>

      {canAward && <PointItems />}

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}
      {loading ? (
        <SkeletonList rows={6} />
      ) : ranked.length === 0 ? (
        <EmptyHive caption="아직 모인 꿀이 없어요" sub="출석·숙제·칭찬을 기록하면 여기 쌓여요." />
      ) : (
        <div className="rank-list">
          {ranked.map((r, i) => (
            <div className={"rank-row" + (i < 3 ? " top" : "") + (i === 0 ? " queen" : "")} key={r.studentId}>
              <div className="rank-no">{i + 1}</div>
              <div className="rank-av">
                {i === 0 && <Crown className="rank-crown" />}
                <HexAvatar name={r.name} size={40} />
              </div>
              <div className="rank-name">{r.name}{r.grade ? <span className="rank-grade">{r.grade}</span> : null}</div>
              <div className="rank-days" title="꿀(포인트)을 모은 날 수예요">꿀 모은 {r.days}일</div>
              <div className={"rank-pts" + (r.points < 0 ? " minus" : "")}>
                {r.points >= 0 && <HoneyDrop size={15} className="rank-drop" />}
                {r.points.toLocaleString()}<span>꿀</span>
              </div>
              {canAward && (
                <button
                  className="btn ghost sm rank-award"
                  onClick={() => award(r)}
                  disabled={!!busy}
                  title="시상 후 이 학생의 꿀을 0으로 초기화"
                >
                  {busy === r.studentId ? "처리 중…" : "적립완료"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
