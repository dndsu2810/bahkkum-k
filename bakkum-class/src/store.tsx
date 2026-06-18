import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { DataSnapshot, SnapshotDeletions } from "./types";
import type { PageId } from "./lib/nav";
import { loadData, saveData, saveDataNow } from "./api";

/* ---- 병합 저장용 삭제 추적 ----
   전체 교체 대신 'upsert + 삭제 목록'으로 저장해 여러 강사가 동시에 써도 서로 덮어쓰지 않게 한다.
   세션 동안 삭제한 레코드 id를 누적했다가 저장 때 함께 보내고, 새로 불러오면(reload) 비운다. */
interface DelSets {
  homework: Set<string>; progress: Set<string>; test: Set<string>; supplement: Set<string>; makeup: Set<string>;
  task: Set<string>; attendance: Set<string>; dismissed: Set<string>; noHomework: Set<string>;
}
function emptyDel(): DelSets {
  return { homework: new Set(), progress: new Set(), test: new Set(), supplement: new Set(), makeup: new Set(), task: new Set(), attendance: new Set(), dismissed: new Set(), noHomework: new Set() };
}
function accumulateRemovals(cur: DataSnapshot, next: DataSnapshot, del: DelSets): void {
  const removedById = (before: { id: string }[] = [], after: { id: string }[] = [], set: Set<string>) => {
    const a = new Set(after.map((x) => x.id));
    for (const x of before) if (!a.has(x.id)) set.add(x.id);
    for (const x of after) set.delete(x.id); // 재추가되면 삭제표시 해제
  };
  removedById(cur.homeworkLog, next.homeworkLog, del.homework);
  removedById(cur.progressLog, next.progressLog, del.progress);
  removedById(cur.testLog, next.testLog, del.test);
  removedById(cur.supplements || [], next.supplements || [], del.supplement);
  removedById(cur.makeups, next.makeups, del.makeup);
  removedById(cur.tasks || [], next.tasks || [], del.task);
  const removedByKey = (before: string[] = [], after: string[] = [], set: Set<string>) => {
    const a = new Set(after);
    for (const k of before) if (!a.has(k)) set.add(k);
    for (const k of after) set.delete(k);
  };
  removedByKey(Object.keys(cur.attendance || {}), Object.keys(next.attendance || {}), del.attendance);
  removedByKey(cur.dismissedMakeups || [], next.dismissedMakeups || [], del.dismissed);
  removedByKey(cur.noHomework || [], next.noHomework || [], del.noHomework);
}
function serializeDel(del: DelSets): SnapshotDeletions | undefined {
  const out: SnapshotDeletions = {};
  if (del.homework.size) out.homework = [...del.homework];
  if (del.progress.size) out.progress = [...del.progress];
  if (del.test.size) out.test = [...del.test];
  if (del.supplement.size) out.supplement = [...del.supplement];
  if (del.makeup.size) out.makeup = [...del.makeup];
  if (del.task.size) out.task = [...del.task];
  if (del.attendance.size) out.attendance = [...del.attendance];
  if (del.dismissed.size) out.dismissed = [...del.dismissed];
  if (del.noHomework.size) out.noHomework = [...del.noHomework];
  return Object.keys(out).length ? out : undefined;
}

interface ToastItem {
  id: number;
  msg: string;
  undo?: () => void;
}

interface StoreCtx {
  data: DataSnapshot;
  loaded: boolean;
  /** 초기 로드 실패(원격 읽기 에러) — true면 저장이 막혀 데이터 보호됨. */
  loadError: string | null;
  /** 초기 로드를 다시 시도. */
  retryLoad: () => void;
  /** Mutate a deep copy of the snapshot, commit it to state, and persist. */
  mutate: (fn: (draft: DataSnapshot) => void) => void;
  /** Like mutate, but persists immediately and resolves true/false on save success. */
  mutateAsync: (fn: (draft: DataSnapshot) => void) => Promise<boolean>;
  /** Re-fetch the snapshot from the backend (e.g. after a Notion sync). */
  reload: (opts?: { silent?: boolean }) => Promise<void>;
  /** 토스트. undo를 주면 '되돌리기' 버튼이 잠깐(5초) 뜬다. */
  toast: (msg: string, undo?: () => void) => void;
  dismissToast: (id: number) => void;
  toasts: ToastItem[];
  openModal: (node: ReactNode) => void;
  closeModal: () => void;
  modal: ReactNode | null;
  /** 현재 보고 있는 페이지 + 화면 이동 ([오늘] 링크 등에서 사용). */
  page: PageId;
  navigate: (p: PageId) => void;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DataSnapshot>({
    students: [],
    makeups: [],
    attendance: {},
    homeworkLog: [],
    progressLog: [],
    testLog: [],
    tasks: [],
    dismissedMakeups: [],
    noHomework: [],
  });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [modal, setModal] = useState<ReactNode | null>(null);
  const [page, setPage] = useState<PageId>("today");
  const toastId = useRef(0);
  // 로드 실패 동안 저장을 막아 원격 데이터가 빈 값으로 덮어써지지 않게 한다.
  const blockSave = useRef(false);
  // 마지막 편집 시각 — 탭 복귀 시 '오래된 탭'을 자동 새로고침할지 판단(편집 직후엔 보호).
  const lastMutate = useRef(0);
  // 이 세션에서 삭제한 레코드(병합 저장용). 새로 불러올 때 비운다.
  const pendingDel = useRef<DelSets>(emptyDel());

  const doLoad = useCallback(() => {
    let alive = true;
    setLoadError(null);
    loadData()
      .then((snap) => {
        if (!alive) return;
        setData(snap);
        setLoaded(true);
        blockSave.current = false;
        pendingDel.current = emptyDel(); // 최신 데이터 — 이전 삭제표시 비움
      })
      .catch((e) => {
        if (!alive) return;
        // 화면을 비우지 않고(기존 data 유지) 저장만 차단 + 에러 표시
        blockSave.current = true;
        setLoadError(String(e?.message || e));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => doLoad(), [doLoad]);

  const mutate = useCallback((fn: (draft: DataSnapshot) => void) => {
    if (blockSave.current) {
      // 데이터를 못 불러온 상태 — 저장하면 원격을 덮어쓸 수 있어 막는다.
      setToasts((t) => [
        ...t,
        { id: ++toastId.current, msg: "데이터를 불러오지 못해 저장이 잠겨 있어요. 새로고침 해주세요." },
      ]);
      return;
    }
    lastMutate.current = Date.now();
    setData((cur) => {
      const next: DataSnapshot = structuredClone(cur);
      fn(next);
      accumulateRemovals(cur, next, pendingDel.current);
      saveData({ ...next, deletions: serializeDel(pendingDel.current) });
      return next;
    });
  }, []);

  const mutateAsync = useCallback(async (fn: (draft: DataSnapshot) => void): Promise<boolean> => {
    if (blockSave.current) {
      setToasts((t) => [
        ...t,
        { id: ++toastId.current, msg: "데이터를 불러오지 못해 저장이 잠겨 있어요. 새로고침 해주세요." },
      ]);
      return false;
    }
    lastMutate.current = Date.now();
    let next: DataSnapshot | null = null;
    setData((cur) => {
      next = structuredClone(cur);
      fn(next!);
      accumulateRemovals(cur, next!, pendingDel.current);
      return next;
    });
    return next ? await saveDataNow({ ...(next as DataSnapshot), deletions: serializeDel(pendingDel.current) }) : false;
  }, []);

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      const snap = await loadData();
      setData(snap);
      blockSave.current = false;
      setLoadError(null);
      pendingDel.current = emptyDel(); // 최신 데이터 반영 — 삭제표시 비움
    } catch (e) {
      // 실패해도 기존 데이터는 유지(덮어쓰지 않음).
      // 백그라운드 동기화(포커스·45초 주기)는 저장이 몰려 순간 끊겨도 매번 경고를 띄우지 않는다
      // — 다음 주기에 자동으로 다시 시도한다. 사용자가 직접 누른 새로고침만 안내 토스트.
      if (!opts?.silent) {
        setToasts((t) => [...t, { id: ++toastId.current, msg: "최신 데이터를 불러오지 못했어요." }]);
      }
      void e;
    }
  }, []);

  // 여러 탭/기기를 함께 쓸 때 — 다른 탭에서 정리(삭제·학년수정)한 내용이 '오래된 탭'의
  // 전체 저장으로 되살아나는 문제 방지. 탭으로 돌아오면(focus/visible) 최근 편집이 없을 때
  // 최신 데이터로 새로고침한다. (편집 직후 3초는 보호 — 입력 중 덮어쓰기 방지)
  useEffect(() => {
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (blockSave.current) return;
      if (Date.now() - lastMutate.current < 3000) return;
      void reload({ silent: true }); // 백그라운드 동기화 — 실패해도 조용히(다음 주기 재시도)
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    // 두 화면을 계속 띄워두는 경우(데스크+강사 등)도 수렴하도록 주기적으로도 최신화.
    const iv = window.setInterval(onVisible, 45000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(iv);
    };
  }, [reload]);

  const toast = useCallback((msg: string, undo?: () => void) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, undo }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, undo ? 5200 : 2700);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const openModal = useCallback((node: ReactNode) => setModal(node), []);
  const closeModal = useCallback(() => setModal(null), []);
  const navigate = useCallback((p: PageId) => setPage(p), []);
  const retryLoad = useCallback(() => {
    doLoad();
  }, [doLoad]);

  return (
    <Ctx.Provider
      value={{ data, loaded, loadError, retryLoad, mutate, mutateAsync, reload, toast, dismissToast, toasts, openModal, closeModal, modal, page, navigate }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): StoreCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore must be used within StoreProvider");
  return c;
}
