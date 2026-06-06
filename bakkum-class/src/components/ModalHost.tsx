import { useEffect } from "react";
import { useStore } from "../store";

/** Renders the active modal inside the overlay, with backdrop + Esc to close. */
export function ModalHost() {
  const { modal, closeModal } = useStore();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeModal();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeModal]);

  return (
    <div
      className={"overlay" + (modal ? " open" : "")}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div className="modal">{modal}</div>
    </div>
  );
}

export function ToastHost() {
  const { toasts } = useStore();
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
