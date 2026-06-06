import type { ReportExtras } from "./reportTypes";
import { emptyExtras } from "./reportTypes";

// Report extras (evaluations/homework/progress/comment/notes) are entered by the
// teacher and kept in the browser, keyed by student + month.
const keyFor = (studentId: string, ym: string) => "bk_report_" + studentId + "_" + ym;

export function loadExtras(studentId: string, ym: string): ReportExtras | null {
  try {
    const raw = localStorage.getItem(keyFor(studentId, ym));
    if (!raw) return null;
    return { ...emptyExtras(), ...(JSON.parse(raw) as ReportExtras) };
  } catch {
    return null;
  }
}

export function saveExtras(studentId: string, ym: string, extras: ReportExtras): void {
  try {
    localStorage.setItem(keyFor(studentId, ym), JSON.stringify(extras));
  } catch {
    /* ignore quota errors */
  }
}
