// 수학 전광판 패널 — 학생 모달·선생님 화면 공용. board(MathBoard)만 받아 그린다.
import { useState } from "react";
import type { MathBoard, BoardRecent } from "../lib/baseball";
import { statusLabel } from "../lib/baseball";

function Dots({ filled, total, tone }: { filled: number; total: number; tone: "strike" | "ball" | "out" }) {
  return (
    <span className="bb-dots">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={"bb-dot " + (i < filled ? "on bb-" + tone : "")} />
      ))}
    </span>
  );
}

const RECENT_TONE: Record<BoardRecent["tone"], { cls: string; txt: string }> = {
  strike: { cls: "bb-rc-strike", txt: "S" },
  ball: { cls: "bb-rc-ball", txt: "볼" },
  minus: { cls: "bb-rc-minus", txt: "−" },
  makeup: { cls: "bb-rc-makeup", txt: "보충" },
  honey: { cls: "bb-rc-honey", txt: "꿀" },
};

export function Scoreboard({ board, showRecent = true }: { board: MathBoard; showRecent?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const round = board.penaltyRounds + 1; // 1회부터 시작, 쓰리아웃 초기화마다 +1

  // 회차별 그룹(최신 회차 먼저).
  const byRound = new Map<number, BoardRecent[]>();
  for (const h of board.history) {
    const arr = byRound.get(h.round) || [];
    arr.push(h);
    byRound.set(h.round, arr);
  }
  const rounds = [...byRound.keys()].sort((a, b) => b - a);
  return (
    <div className="bb-board-wrap">
      <div className="bb-panel">
        <div className="bb-row">
          <div className="bb-rowtop">
            <span className="bb-rl-strike">스트라이크</span>
            <Dots filled={board.S} total={3} tone="strike" />
            <b className="bb-rowcount">{board.S}<span>개</span></b>
          </div>
          <em className="bb-rowdesc">벌점 — 삼진(3개) 시 아웃 1개</em>
        </div>
        <div className="bb-row">
          <div className="bb-rowtop">
            <span className="bb-rl-ball">볼</span>
            <Dots filled={board.B} total={4} tone="ball" />
            <b className="bb-rowcount">{board.B}<span>개</span></b>
          </div>
          <em className="bb-rowdesc">상점 — 볼넷이면 아웃 1개 감소</em>
        </div>
        <div className="bb-row">
          <div className="bb-rowtop">
            <span className="bb-rl-out">아웃</span>
            <Dots filled={board.O} total={3} tone="out" />
            <b className="bb-rowcount">{board.O}<span>개</span></b>
          </div>
          <em className="bb-rowdesc">쓰리아웃 시 상상 그 이상^^</em>
        </div>
      </div>

      <div className="bb-meta">
        <span className={"bb-status bb-st-" + board.status}>현재 {round}회</span>
        {board.pendingMakeup && <span className="bb-status bb-st-makeup">지금 보충 대상</span>}
        {board.status !== "clean" && !board.pendingMakeup && <span className={"bb-status bb-st-" + board.status}>{statusLabel(board.status)}</span>}
        {board.honey > 0 && <span className="bb-honeycount">꿀 전환 {board.honey}회</span>}
      </div>

      <div className={"bb-goal" + (board.pendingMakeup ? " danger" : board.status === "clean" ? " clean" : "")}>
        <span className="bb-goal-counts">스트라이크 {board.S}개 · 볼 {board.B}개 · 아웃 {board.O}개</span>
        <span className="bb-goal-msg">{board.goal}</span>
      </div>

      {showRecent && board.history.length > 0 && (
        <div className="bb-recent">
          <div className="bb-recent-head">
            <p className="bb-recent-h">{showAll ? "회차별 기록" : "최근 기록"}</p>
            <button className="bb-recent-toggle" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "접기" : "기록 보기 (회차별)"}
            </button>
          </div>

          {!showAll && board.recent.map((r, i) => (
            <div className="bb-recent-row" key={i}>
              <span className={"bb-recent-chip " + RECENT_TONE[r.tone].cls}>{r.delta}</span>
              <span className="bb-recent-label">{r.label}</span>
              <span className="bb-recent-rd">{r.round}회</span>
              <span className="bb-recent-date">{r.date.slice(5).replace("-", "/")}</span>
            </div>
          ))}

          {showAll && rounds.map((rd) => (
            <div className="bb-round-group" key={rd}>
              <div className="bb-round-h"><b>{rd}회차</b>{rd === round && <span className="bb-round-now">진행 중</span>}</div>
              {(byRound.get(rd) || []).map((r, i) => (
                <div className="bb-recent-row" key={i}>
                  <span className={"bb-recent-chip " + RECENT_TONE[r.tone].cls}>{r.delta}</span>
                  <span className="bb-recent-label">{r.label}</span>
                  <span className="bb-recent-date">{r.date.slice(5).replace("-", "/")}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
