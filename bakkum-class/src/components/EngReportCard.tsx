import { ENG_CRITERIA, ENG_GRADES } from "../lib/engApi";
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
}

function ymLabel(month: string): string {
  const [y, mo] = month.split("-");
  return `${y}년 ${Number(mo)}월`;
}

/* ---------------- 레이더 차트 (8축 0~6) ---------------- */
function Radar({ scores }: { scores: Record<string, string> }) {
  const size = 360;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const maxR = 128;
  const N = ENG_CRITERIA.length; // 8
  const ang = (i: number) => (-90 + (360 / N) * i) * (Math.PI / 180);
  const pt = (i: number, r: number) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  const polyAt = (level: number) =>
    ENG_CRITERIA.map((_, i) => pt(i, (level / 6) * maxR).join(",")).join(" ");
  // 학생 점수 폴리곤
  const dataPts = ENG_CRITERIA.map((c, i) => pt(i, (scoreOf(scores[c.key]) / 6) * maxR).join(",")).join(" ");
  // 비교(기준)선 — Great(4) 기준 점선.
  const refLevel = 4;

  return (
    <svg className="erc3-radar" width={size} height={size + 28} viewBox={`0 0 ${size} ${size + 28}`}>
      {/* 그리드 링 */}
      {[1, 2, 3, 4, 5, 6].map((lv) => (
        <polygon key={lv} points={polyAt(lv)} fill="none" stroke="#E2E8EC" strokeWidth={1} />
      ))}
      {/* 축선 */}
      {ENG_CRITERIA.map((_, i) => {
        const [x, y] = pt(i, maxR);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#E2E8EC" strokeWidth={1} />;
      })}
      {/* 기준선(점선) */}
      <polygon points={polyAt(refLevel)} fill="none" stroke="#9AA8B4" strokeWidth={1.5} strokeDasharray="5 4" />
      {/* 학생 점수 */}
      <polygon points={dataPts} fill="rgba(22,128,143,.20)" stroke="#16808F" strokeWidth={2.5} strokeLinejoin="round" />
      {ENG_CRITERIA.map((c, i) => {
        const [x, y] = pt(i, (scoreOf(scores[c.key]) / 6) * maxR);
        return <circle key={i} cx={x} cy={y} r={3.2} fill="#16808F" />;
      })}
      {/* 축 라벨 */}
      {AXIS.map((label, i) => {
        const [x, y] = pt(i, maxR + 20);
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

  const Header = ({ right }: { right?: string }) => (
    <div className="erc3-head">
      <div className="erc3-brand">
        <div>
          <b>바꿈영수학원</b>
          <span>Bakkum English &amp; Math Academy</span>
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
            {ENG_CRITERIA.map((c) => {
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
        <Radar scores={data.scores} />
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
        <div className="erc3-comment">{data.comments?.trim() ? data.comments : "코멘트가 아직 없습니다."}</div>
        <Foot />
      </div>
    </>
  );
}
