import { useEffect, useState } from "react";
import { engApi, type EngRanking } from "../lib/engApi";
import { SkeletonList } from "../components/Skeleton";

/** 학생 포인트 랭킹 — 영어 수업기록 포인트(적립−차감) 누적 합 순위. 공통. */
export function PointRanking() {
  const [list, setList] = useState<EngRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    engApi
      .ranking()
      .then((r) => { setList(r); setLoading(false); })
      .catch(() => { setErr("불러오지 못했어요. 잠시 후 다시 시도해 주세요."); setLoading(false); });
  }, []);

  const ranked = list.filter((r) => r.points !== 0 || r.days > 0);
  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "");

  return (
    <div className="sm-wrap">
      <div className="sm-head">
        <div>
          <h1 className="sm-title">포인트 랭킹</h1>
          <p className="sm-desc">출석·숙제·칭찬 등 적립과 지각·차감을 합산한 학생별 누적 포인트입니다.</p>
        </div>
        <div className="sm-count">{ranked.length}명</div>
      </div>

      {err && <div className="auth-err" style={{ marginBottom: 10 }}>{err}</div>}
      {loading ? (
        <SkeletonList rows={6} />
      ) : ranked.length === 0 ? (
        <div className="hub-muted" style={{ padding: 20 }}>아직 포인트 기록이 없어요. 영어 출결·포인트를 입력하거나 노션에서 가져오면 여기 모여요.</div>
      ) : (
        <div className="rank-list">
          {ranked.map((r, i) => (
            <div className={"rank-row" + (i < 3 ? " top" : "")} key={r.studentId}>
              <div className="rank-no">{medal(i) || i + 1}</div>
              <div className="rank-name">{r.name}{r.grade ? <span className="rank-grade">{r.grade}</span> : null}</div>
              <div className="rank-days">{r.days}일</div>
              <div className={"rank-pts" + (r.points < 0 ? " minus" : "")}>{r.points.toLocaleString()}<span>점</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
