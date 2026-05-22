// 모바일 안내 (지현 선택: PC·태블릿만, 폰은 안내 메시지만).
// 작은 화면에서만 보임.
export default function MobileNotice() {
  return (
    <div className="bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-700 sm:hidden">
      게임은 카메라로 온몸을 인식해요. 큰 화면(PC·태블릿)에서 가장 잘 됩니다.
    </div>
  );
}
