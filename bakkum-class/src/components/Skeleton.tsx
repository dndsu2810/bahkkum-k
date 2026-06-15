// 로딩 스켈레톤 — 목록·카드를 불러오는 동안 빈 화면 대신 회색 자리표시.
// "불러오는 중…" 텍스트보다 체감 속도가 빠르고 깔끔하다.

/** 단일 회색 블록. w/h는 CSS 값(예 "60%", 16), r=모서리 반경. */
export function Skeleton({ w = "100%", h = 14, r = 8, style }: { w?: number | string; h?: number | string; r?: number; style?: React.CSSProperties }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

/** 목록 자리표시 — 한 줄에 아바타 + 제목/부제. 명단·랭킹 등. */
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skel-list" aria-label="불러오는 중" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skel-row" key={i}>
          <Skeleton w={36} h={36} r={10} />
          <div className="skel-row-t">
            <Skeleton w="42%" h={13} />
            <Skeleton w="26%" h={11} />
          </div>
          <Skeleton w={48} h={22} r={11} />
        </div>
      ))}
    </div>
  );
}

/** 카드 그리드 자리표시 — 대시보드 KPI 등. */
export function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <div className="skel-cards" aria-label="불러오는 중" aria-busy="true">
      {Array.from({ length: n }).map((_, i) => (
        <div className="skel-card" key={i}>
          <Skeleton w="50%" h={12} />
          <Skeleton w="70%" h={28} style={{ marginTop: 12 }} />
        </div>
      ))}
    </div>
  );
}
