import { createContext, useContext } from "react";
import type { AreaKey } from "./lib/roles";

/** 허브 최상위 화면 전환.
 *  - 'math'  : 기존 수학 관리 앱
 *  - 'home'  : 허브 홈(화면 선택)
 *  - AreaKey : 해당 영역 화면(학생 마스터 등) */
export type HubView = "math" | "home" | AreaKey;

interface HubNavCtx {
  view: HubView;
  go: (v: HubView) => void;
  /** 수학 앱에서 '허브' 버튼을 보일지(가진 영역이 둘 이상일 때). */
  canLeaveMath: boolean;
}

const Ctx = createContext<HubNavCtx | null>(null);
export const HubNavProvider = Ctx.Provider;

/** 허브 네비. 허브 밖(예: 단독 렌더)에서는 null 반환을 허용. */
export function useHubNav(): HubNavCtx | null {
  return useContext(Ctx);
}
