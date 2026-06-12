import html2canvas from "html2canvas";

/**
 * Capture #report-card and save it as two stacked PNGs (top/bottom half) —
 * sized for KakaoTalk delivery. Width matches the 768px design sheet.
 */
export async function saveReportAsImages(
  studentName: string,
  year: number,
  month: number
): Promise<void> {
  const card = document.getElementById("report-card");
  if (!card) return;

  const canvas = await html2canvas(card, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    width: 768,
    windowWidth: 768,
  });

  const totalHeight = canvas.height;
  // 화면 절반을 무작정 자르면 달력 같은 섹션이 가운데서 잘린다.
  // → 섹션(.r-sec) / 푸터(.r-ft) 경계 중 '가운데에 가장 가까운' 지점에서 자른다.
  const cardRect = card.getBoundingClientRect();
  const ratio = cardRect.height ? totalHeight / cardRect.height : 2;
  const midCss = cardRect.height / 2;
  const boundaries: number[] = [];
  card.querySelectorAll(".r-sec, .r-ft").forEach((el) => {
    boundaries.push(el.getBoundingClientRect().top - cardRect.top);
  });
  // 너무 위/아래로 치우치지 않게 25~75% 범위의 경계만 후보로 (없으면 전체)
  const lo = cardRect.height * 0.25;
  const hi = cardRect.height * 0.75;
  const inRange = boundaries.filter((b) => b >= lo && b <= hi);
  const pool = inRange.length ? inRange : boundaries;
  let splitCss = midCss;
  let best = Infinity;
  for (const b of pool) {
    const diff = Math.abs(b - midCss);
    if (diff < best) { best = diff; splitCss = b; }
  }
  const half = Math.max(1, Math.min(totalHeight - 1, Math.round(splitCss * ratio)));

  const top = document.createElement("canvas");
  top.width = canvas.width;
  top.height = half;
  top.getContext("2d")!.drawImage(canvas, 0, 0, canvas.width, half, 0, 0, canvas.width, half);

  const bottom = document.createElement("canvas");
  bottom.width = canvas.width;
  bottom.height = totalHeight - half;
  bottom
    .getContext("2d")!
    .drawImage(canvas, 0, half, canvas.width, totalHeight - half, 0, 0, canvas.width, totalHeight - half);

  const prefix = studentName + "_" + year + "년" + month + "월_리포트";
  downloadCanvas(top, prefix + "_1.png");
  await new Promise((r) => setTimeout(r, 500)); // 브라우저 다운로드 간격
  downloadCanvas(bottom, prefix + "_2.png");
}

function downloadCanvas(c: HTMLCanvasElement, filename: string) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = c.toDataURL("image/png");
  link.click();
}
