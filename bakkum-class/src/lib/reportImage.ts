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
  const half = Math.floor(totalHeight / 2);

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
