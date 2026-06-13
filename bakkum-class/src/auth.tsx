import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { AuthUser } from "./lib/roles";
import { fetchMe, logout as apiLogout } from "./lib/authApi";

interface AuthCtx {
  user: AuthUser | null;
  /** 세션 확인 중(초기 로딩). */
  loading: boolean;
  /** 백엔드 없음(dev/static) — 로그인 우회 모드. */
  noBackend: boolean;
  /** 로그인 성공 후 세션 사용자 반영. */
  setUser: (u: AuthUser) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

// dev/static(백엔드 없음)에서 쓰는 우회 사용자 — 기존 수학 워크플로 그대로 동작.
const DEV_USER: AuthUser = { sub: "dev", role: "admin", name: "이지현", scope: ["math"] };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [noBackend, setNoBackend] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchMe()
      .then((u) => {
        if (!alive) return;
        setUserState(u);
        setLoading(false);
      })
      .catch(() => {
        // 백엔드 없음(로컬 vite dev 등) → 우회 로그인으로 기존 앱 그대로 사용
        if (!alive) return;
        setNoBackend(true);
        setUserState(DEV_USER);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setUser = useCallback((u: AuthUser) => setUserState(u), []);
  const logout = useCallback(async () => {
    await apiLogout();
    setUserState(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, noBackend, setUser, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
