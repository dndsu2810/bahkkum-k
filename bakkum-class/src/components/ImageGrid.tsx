import { useState } from "react";

/** 썸네일 그리드 + 클릭하면 확대(라이트박스). SNS·매뉴얼 이미지 표시용. */
export function ImageGrid({ images }: { images: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!images.length) return null;
  return (
    <>
      <div className="imgrid">
        {images.map((src) => (
          <button className="imgrid-th" key={src} onClick={() => setOpen(src)} title="크게 보기">
            <img src={src} loading="lazy" alt="" />
          </button>
        ))}
      </div>
      {open && (
        <div className="imglb" onClick={() => setOpen(null)} role="dialog" aria-label="이미지 확대">
          <img src={open} alt="" onClick={(e) => e.stopPropagation()} />
          <a className="imglb-save" href={open} download onClick={(e) => e.stopPropagation()} aria-label="이미지 저장">저장</a>
          <button className="imglb-x" onClick={() => setOpen(null)} aria-label="닫기">×</button>
        </div>
      )}
    </>
  );
}
