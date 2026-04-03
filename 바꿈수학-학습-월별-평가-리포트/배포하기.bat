@echo off
chcp 65001 > nul
echo =======================================
echo    바꿈수학 리포트 'GitHub 창고' 열기
echo =======================================
echo.
echo 📦 지금 수정하신 리포트를 GitHub 인터넷 세상으로 배달하는 중입니다...
echo (이 작업은 보통 1~3분 정도 걸려요. 잠시만 기다려주세요!)
echo.

:: 1. 배포 실행 (빌드와 업로드를 동시에 진행)
echo 🚀 배송을 시작합니다...
call npm run deploy

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ [오류] 배송 중에 문제가 생겼어요!
    echo 인터넷 연결을 확인해보시거나 저에게 알려주세요.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo =======================================
echo ✨ 배송 완료! GitHub 창고가 업데이트되었습니다! ✨
echo =======================================
echo.
echo 🔗 아래 주소로 접속해서 확인해보세요 (반영까지 1분 정도 걸릴 수 있습니다):
echo https://dndsu2810.github.io/bahkkum/
echo.
echo (이 창은 이제 끄셔도 됩니다. 수고하셨어요!)
echo.
pause
