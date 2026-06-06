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
import { loadData, saveData } from "./api";

interface ToastItem {
  id: number;
  msg: string;
}

interface StoreCtx {
  data: DataSnapshot;
  loaded: boolean;
  /** Mutate a deep copy of the snapshot, commit it to state, and persist. */
  mutate: (fn: (draft: DataSnapshot) => void) => void;
  /** Re-fetch the snapshot from the backend (e.g. after a Notion sync). */
  reload: () => Promise<void>;
  toast: (msg: string) => void;
  toasts: ToastItem[];
  openModal: (node: ReactNode) => void;
  closeModal: () => void;
  modal: ReactNode | null;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DataSnapshot>({
    students: [],
    makeups: [],
    attendance: {},
    homeworkLog: [],
    progressLog: [],
  });
  const [loaded, setLoaded] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [modal, setModal] = useState<ReactNode | null>(null);
  const toastId = useRef(0);

  useEffect(() => {
    let alive = true;
    loadData().then((snap) => {
      if (!alive) return;
      setData(snap);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const mutate = useCallback((fn: (draft: DataSnapshot) => void) => {
    setData((cur) => {
      const next: DataSnapshot = structuredClone(cur);
      fn(next);
      saveData(next);
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    const snap = await loadData();
    setData(snap);
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

  return (
    <Ctx.Provider value={{ data, loaded, mutate, reload, toast, toasts, openModal, closeModal, modal }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): StoreCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore must be used within StoreProvider");
  return c;
}
