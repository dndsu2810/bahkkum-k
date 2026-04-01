@echo off
chcp 65001 > nul
echo =========================================
echo  바꿈수학 월별 평가 리포트 배포 마법사
echo =========================================
echo.
echo 지금 업데이트된 내용을 인터넷에 게시(배포)합니다.
echo 화면에 여러 글자가 지나간 뒤 'Success' 같은
echo 문구가 나타날 때까지 꼭 기다려주세요!
echo (이 창을 중간에 끄면 배포가 실패합니다)
echo.

call npm run build
git add ../docs
git add .
git commit -m "학생 리포트 업데이트"
git push origin main

echo.
echo =========================================
echo 👏👏 배포가 끝났습니다! 👏👏
echo 수정하신 내용이 모두 인터넷에 올라갔습니다.
echo 실제 사이트에는 약 1~2분 뒤에 적용됩니다!
echo =========================================
pause
