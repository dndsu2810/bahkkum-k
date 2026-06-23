// 회의록 화면 캡처 + 세션 쿠키 저장. (puppeteer-core + 시스템 Chrome)
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "https://bakkum-class.dndsu2810.workers.dev";
const NAME = process.env.LOGIN_NAME || "이지현";
const PIN = process.env.LOGIN_PIN || "3811";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync("docs/issue-shots", { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--window-size=1440,1900"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1900, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.evaluate(() => { localStorage.setItem("theme", "light"); document.documentElement.removeAttribute("data-theme"); });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await sleep(800);

  const nameInput = await page.$('input[placeholder="이름"]');
  if (nameInput) {
    await nameInput.type(NAME);
    const pw = await page.$('input[type="password"]');
    if (pw) await pw.type(PIN);
    for (const b of await page.$$("button")) { const t = (await page.evaluate((el) => el.textContent.trim(), b)); if (t === "로그인") { await b.click(); break; } }
    await sleep(3000);
  }
  const stillLogin = await page.$('input[placeholder="이름"]');
  console.log("LOGIN_OK=" + !stillLogin);
  if (stillLogin) { await browser.close(); return; }
  await page.evaluate(() => { localStorage.setItem("theme", "light"); document.documentElement.removeAttribute("data-theme"); });
  await sleep(500);

  async function clickLabel(label) {
    for (const e of await page.$$("button,a,li,div,span")) {
      const ok = await page.evaluate((el, l) => el.textContent.trim() === l && el.offsetParent !== null, e, label);
      if (ok) { await e.click(); return true; }
    }
    return false;
  }
  console.log("NAV=" + (await clickLabel("회의록")));
  await sleep(2000);
  await page.screenshot({ path: "docs/issue-shots/meet-1-screen.png" });

  let opened = false;
  for (const l of ["회의록 작성", "새 회의록", "회의록 만들기", "작성", "새로 만들기", "+ 회의록", "회의록 추가", "기록 추가"]) { if (await clickLabel(l)) { opened = true; console.log("EDITOR_LABEL=" + l); break; } }
  console.log("EDITOR=" + opened);
  await sleep(1500);
  await page.screenshot({ path: "docs/issue-shots/meet-2-editor.png", fullPage: true });

  const cookies = await page.cookies();
  fs.writeFileSync("scripts/cookies.json", JSON.stringify(cookies));
  console.log("COOKIES=" + cookies.length);
  await browser.close();
  console.log("DONE");
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
