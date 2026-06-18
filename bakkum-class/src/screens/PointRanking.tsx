import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { engApi, type EngRanking } from "../lib/engApi";
import { SkeletonList } from "../components/Skeleton";
import { HexAvatar, HoneyDrop, Crown, EmptyHive } from "../soez";

/** 학생 포인트 랭킹 — 영어 수업기록 포인트(적립−차감) 누적 합 순위. 공통. */
export function PointRanking() {
  const { user } = useAuth();
  // 시상('적립완료')은 강사·원장만. 데스크·학생은 보기만.
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
          <p className="sm-desc">출석·숙제·칭찬으로 모은 꿀(포인트) 순위예요. 지각·차감은 빼서 합산해요.</p>
        </div>
        <div className="sm-count">{ranked.length}명</div>
      </div>

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
              <div className="rank-days">{r.days}일</div>
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
