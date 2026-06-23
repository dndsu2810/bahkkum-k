import { SCORE_MODES, computeScore, type ScoreMode } from "../lib/score";

export interface ScoreValue { scoreMode: ScoreMode; scoreNum: number; scoreDen: number; score: number }

const numOf = (v: string) => Number(v.replace(/[^0-9]/g, "")) || 0;

/** 시험 점수 입력 — 작은 토글로 [점수 / 만점 / 갯수] 방식 선택.
 *  점수: 점수 직접. 만점: 받은점수/만점 → 환산. 갯수: 맞힌수/총문항 → 환산.
 *  onChange로 {scoreMode, scoreNum, scoreDen, score(환산 0~100)}를 넘긴다. */
export function ScoreInput({ mode, num, den, onChange }: {
  mode: ScoreMode;
  num: number; // 점수(score) 또는 받은점수/맞힌수
  den: number; // 만점 또는 총문항
  onChange: (v: ScoreValue) => void;
}) {
  const emit = (m: ScoreMode, n: number, d: number) => onChange({ scoreMode: m, scoreNum: n, scoreDen: d, score: computeScore(m, n, d) });
  const score = computeScore(mode, num, den);
  return (
    <span className="score-input">
      <span className="score-modes">
        {SCORE_MODES.map((m) => (
          <button key={m.key} type="button" className={mode === m.key ? "on" : ""} title={m.hint} onClick={() => emit(m.key, num, den)}>{m.label}</button>
        ))}
      </span>
      {mode === "score" ? (
        <span className="score-fields">
          <input className="input score-in" inputMode="numeric" value={num ? String(num) : ""} placeholder="점수" onChange={(e) => emit("score", numOf(e.target.value), den)} />
          <span className="score-unit">점</span>
        </span>
      ) : (
        <span className="score-fields">
          <input className="input score-in" inputMode="numeric" value={num ? String(num) : ""} placeholder={mode === "max" ? "점수" : "맞힌"} onChange={(e) => emit(mode, numOf(e.target.value), den)} />
          <span className="score-slash">/</span>
          <input className="input score-in" inputMode="numeric" value={den ? String(den) : ""} placeholder={mode === "max" ? "만점" : "문항"} onChange={(e) => emit(mode, num, numOf(e.target.value))} />
          {mode === "ratio" && <span className="score-unit">문항</span>}
          <b className="score-out">→ {score}점</b>
        </span>
      )}
    </span>
  );
}
