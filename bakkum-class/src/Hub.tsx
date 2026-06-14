import { StoreProvider } from "./store";
import { useAuth } from "./auth";
import { Login } from "./screens/Login";
import { AuthSplash } from "./screens/RoleHome";
import { StudentHome } from "./screens/StudentPage";
import { Workspace } from "./Workspace";

/** 통합 허브 최상위 — 로그인하면 역할별 단일 사이드바(Workspace)가 바로 열린다. */
export function Hub() {
  const { user, loading } = useAuth();
  if (loading) return <AuthSplash />;
  if (!user) return <Login />;
  if (user.role === "student") return <StudentHome />;
  return (
    <StoreProvider>
      <Workspace />
    </StoreProvider>
  );
}
