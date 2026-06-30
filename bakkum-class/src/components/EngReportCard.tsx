import { ENG_CRITERIA, ENG_GRADES, type EngCriterion } from "../lib/engApi";
import "../styles/engReportCard.css";

const GRADE_FULL: Record<string, string> = Object.fromEntries(ENG_GRADES.map((g) => [g.value, g.full]));
// 등급 약자 → 레이더 점수(0~6). P=6 … NI=1, 미입력=0. (ENG_GRADES 순서 기준)
const SCORE_OF: Record<string, number> = Object.fromEntries(ENG_GRADES.map((g, i) => [g.value, ENG_GRADES.length - i]));
function scoreOf(grade: string): number {
  return SCORE_OF[grade] || 0;
}
// 레이더 축 라벨(짧게)
const AXIS = ["Listening", "Reading", "Speaking", "Spelling & Writing", "Comprehension", "Attitude", "Performance", "Confidence"];

export interface EngReportCardData {
  name: string;
  englishName: string;
  grade: string;
  teacher: string;
  month: string; // YYYY-MM
  scores: Record<string, string>;
  comments: string;
  criteria?: EngCriterion[]; // 학생별 등급표 항목(없으면 기본 8항목)
}

function ymLabel(month: string): string {
  const [y, mo] = month.split("-");
  return `${y}년 ${Number(mo)}월`;
}

/* ---------------- 레이더 차트 (8축 0~6) ---------------- */
function Radar({ scores, criteria }: { scores: Record<string, string>; criteria?: EngCriterion[] }) {
  const crits = criteria && criteria.length ? criteria : ENG_CRITERIA;
  // 기본 항목이면 짧은 축 라벨(AXIS), 맞춤 항목이면 영문 라벨 사용.
  const axisLabels = crits === ENG_CRITERIA ? AXIS : crits.map((c) => c.en);
  // SVG를 카드 폭에 맞춰(=중앙정렬 불필요) 넓게 두고, 차트 원은 가운데에.
  // 좌우 라벨이 viewBox 안에 충분히 들어오게 해서 저장 이미지에서도 안 잘리게.
  const W = 718;
  const H = 360;
  const cx = W / 2;
  const cy = H / 2 + 4;
  const maxR = 118;
  const labelR = maxR + 16;
  const N = Math.max(1, crits.length);
  const ang = (i: number) => (-90 + (360 / N) * i) * (Math.PI / 180);
  const pt = (i: number, r: number) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  const polyAt = (level: number) =>
    crits.map((_, i) => pt(i, (level / 6) * maxR).join(",")).join(" ");
  // 학생 점수 폴리곤
  const dataPts = crits.map((c, i) => pt(i, (scoreOf(scores[c.key]) / 6) * maxR).join(",")).join(" ");
  // 비교(기준)선 — Great(4) 기준 점선.
  const refLevel = 4;

  return (
    <svg className="erc3-radar" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* 그리드 링 */}
      {[1, 2, 3, 4, 5, 6].map((lv) => (
        <polygon key={lv} points={polyAt(lv)} fill="none" stroke="#E2E8EC" strokeWidth={1} />
      ))}
      {/* 축선 */}
      {crits.map((_, i) => {
        const [x, y] = pt(i, maxR);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#E2E8EC" strokeWidth={1} />;
      })}
      {/* 기준선(점선) */}
      <polygon points={polyAt(refLevel)} fill="none" stroke="#9AA8B4" strokeWidth={1.5} strokeDasharray="5 4" />
      {/* 학생 점수 */}
      <polygon points={dataPts} fill="rgba(22,128,143,.20)" stroke="#16808F" strokeWidth={2.5} strokeLinejoin="round" />
      {crits.map((c, i) => {
        const [x, y] = pt(i, (scoreOf(scores[c.key]) / 6) * maxR);
        return <circle key={i} cx={x} cy={y} r={3.2} fill="#16808F" />;
      })}
      {/* 축 라벨 */}
      {axisLabels.map((label, i) => {
        const [x, y] = pt(i, labelR);
        const anchor = Math.abs(x - cx) < 6 ? "middle" : x > cx ? "start" : "end";
        return (
          <text key={i} x={x} y={y} className="erc3-axis-l" textAnchor={anchor} dominantBaseline="middle">
            {label}
          </text>
        );
      })}
    </svg>
  );
}

/* ---------------- 3장 양식 ---------------- */
export function EngReportCard({ baseId, data }: { baseId: string; data: EngReportCardData }) {
  const who = `${data.name}${data.englishName ? " " + data.englishName : ""}`;
  const ym = ymLabel(data.month);
  const crits = data.criteria && data.criteria.length ? data.criteria : ENG_CRITERIA;

  const Header = ({ right }: { right?: string }) => (
    <div className="erc3-head">
      <div className="erc3-brand">
        <div>
          <b>바꿈영수학원</b>
        </div>
      </div>
      {right ? <div className="erc3-head-right">{right}</div> : (
        <div className="erc3-head-card">
          <b>Student Progress Report</b>
          <span>성적표</span>
        </div>
      )}
    </div>
  );
  const Foot = () => (
    <div className="erc3-foot">
      <span>Academic Assessment Report · Bakkum Academy</span>
      <span>{ym}</span>
    </div>
  );

  return (
    <>
      {/* 1장 — 표지 + 평가표 */}
      <div id={`${baseId}-1`} className="erc3 erc3-p1">
        <Header />
        <div className="erc3-info">
          <div className="erc3-info-it"><span>학생</span><b>{who}</b></div>
          <div className="erc3-info-it"><span>선생님</span><b>{data.teacher || "—"}</b></div>
          <div className="erc3-info-it"><span>평가월</span><b>{ym}</b></div>
          <div className="erc3-info-it"><span>학년</span><b>{data.grade || "—"}</b></div>
        </div>
        <div className="erc3-table-tag">Categorized Evaluation · 항목별 평가</div>
        <table className="erc3-table">
          <thead>
            <tr><th>CRITERIA</th><th>SCORE</th><th>GRADE</th></tr>
          </thead>
          <tbody>
            {crits.map((c) => {
              const g = data.scores[c.key] || "";
              return (
                <tr key={c.key}>
                  <td className="erc3-cri"><b>{c.en}</b> <span>{c.ko}</span></td>
                  <td><span className={"erc3-badge g-" + (g || "none")}>{g || "—"}</span></td>
                  <td className="erc3-full">{g ? GRADE_FULL[g] : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Foot />
      </div>

      {/* 2장 — 레이더 + 범례 */}
      <div id={`${baseId}-2`} className="erc3 erc3-p2">
        <Header right={`${who} · ${ym}`} />
        <div className="erc3-sec-tag">Point Spread Analysis · 영역별 분포</div>
        <Radar scores={data.scores} criteria={crits} />
        <div className="erc3-scale">
          <div className="erc3-scale-h">GRADING SCALE</div>
          <div className="erc3-scale-row">
            {ENG_GRADES.map((g) => (
              <span key={g.value} className="erc3-scale-it"><b className={"erc3-badge g-" + g.value}>{g.value}</b> {g.full}</span>
            ))}
          </div>
        </div>
        <Foot />
      </div>

      {/* 3장 — 코멘트 */}
      <div id={`${baseId}-3`} className="erc3 erc3-p3">
        <Header right={`${who} · ${ym}`} />
        <div className="erc3-sec-tag">Teacher's Comments · 선생님 코멘트</div>
        <div className="erc3-comment">{data.comments?.trim() ? data.comments : "아직 코멘트가 없어요."}</div>
        <Foot />
      </div>
    </>
  );
}
