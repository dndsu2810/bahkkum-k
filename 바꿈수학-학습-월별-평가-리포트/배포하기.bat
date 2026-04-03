@echo off
chcp 65001 > nul
echo =========================================
echo  바꿈수학 월별 평가 리포트 배포 마법사
echo =========================================
echo.
echo 인터넷 사이트로 지금 바로 전송합니다!
echo.
call npm run build --silent
echo.
echo 인터넷(Surge) 서버로 전송 중입니다... (약 1분 이내 소요)
call node --no-warnings deploy_surge.cjs

echo.
echo =========================================
echo 👏👏 배포가 끝났습니다! 👏👏
echo 이제 머리아픈 깃허브 설정은 잊으시고
echo 무조건 이 주소만 외우시면 됩니다:
echo 👉 https://dndsu2810-bahkkum.surge.sh
echo =========================================
pause
