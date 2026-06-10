import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { DataSnapshot } from "./types";
import type { PageId } from "./lib/nav";
import { loadData, saveData, saveDataNow } from "./api";

interface ToastItem {
  id: number;
  msg: string;
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
  reload: () => Promise<void>;
  toast: (msg: string) => void;
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

  const doLoad = useCallback(() => {
    let alive = true;
    setLoadError(null);
    loadData()
      .then((snap) => {
        if (!alive) return;
        setData(snap);
        setLoaded(true);
        blockSave.current = false;
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
    setData((cur) => {
      const next: DataSnapshot = structuredClone(cur);
      fn(next);
      saveData(next);
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
    let next: DataSnapshot | null = null;
    setData((cur) => {
      next = structuredClone(cur);
      fn(next);
      return next;
    });
    return next ? await saveDataNow(next) : false;
  }, []);

  const reload = useCallback(async () => {
    try {
      const snap = await loadData();
      setData(snap);
      blockSave.current = false;
      setLoadError(null);
    } catch (e) {
      // 실패해도 기존 데이터는 유지(덮어쓰지 않음)
      setToasts((t) => [...t, { id: ++toastId.current, msg: "최신 데이터를 불러오지 못했어요." }]);
      void e;
    }
  }, []);

  const toast = useCallback((msg: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 2700);
  }, []);

  const openModal = useCallback((node: ReactNode) => setModal(node), []);
  const closeModal = useCallback(() => setModal(null), []);
  const navigate = useCallback((p: PageId) => setPage(p), []);
  const retryLoad = useCallback(() => {
    doLoad();
  }, [doLoad]);

  return (
    <Ctx.Provider
      value={{ data, loaded, loadError, retryLoad, mutate, mutateAsync, reload, toast, toasts, openModal, closeModal, modal, page, navigate }}
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
