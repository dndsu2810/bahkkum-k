// 일회성: 노션 진도표를 읽어 정리한 학생별 커리큘럼을 D1용 SQL로 생성.
// 실행: node scripts/seed-curriculum.mjs > /tmp/cur.sql  → wrangler d1 execute --file
import { writeFileSync } from "node:fs";

const NOTE = "1개의 학습을 완전히 마무리 하고 다음 학습으로 넘어가세요.";
const DAILY = "⭐ 매일 반복";
const CONT = "지난 시간에 이어서 학습";
const r = (name, amount = "") => ({ name, amount });

// student_id → {note, sections}
const DATA = {
  // 김하린
  "2": { sections: [
    { title: DAILY, rows: [r("단어시험", "10개씩 객관식"), r("자판 연습하기", "매일 1개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료"), r("Practice Book", "1 Unit씩"), r("원서 읽고 독서기록장 쓰기", "1개")] },
  ] },
  // 고하준
  "41": { sections: [
    { title: DAILY, rows: [r("단어시험", "25개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료, Link 온라인 학습 1개 하기"), r("link 교재", "1 Unit씩"), r("원서 읽고 독서기록장 쓰기", "1개"), r("판다라이팅", "1 Unit씩"), r("필기체쓰기", "1개")] },
  ] },
  // 김지후
  "20": { sections: [
    { title: DAILY, rows: [r("단어시험", "25개씩"), r("원서 읽고 독서기록장 쓰기", "하루에 한 개 꼭!")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료, Link 온라인 학습 1개 하기"), r("link 교재", "Insight Link Starter3 1 Unit씩"), r("필기체쓰기", "1개"), r("판다라이팅", "1 Unit씩")] },
  ] },
  // 민서준
  "1": { sections: [
    { title: DAILY, rows: [r("단어시험", "10개씩"), r("스냅파닉스", "1개"), r("practice book", "하루에 한 개 꼭!")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료 후, Link 온라인 학습하기"), r("link 교재", "1 Unit"), r("원서 읽고 독서기록장 쓰기 (마지막 번호쓰기)", "1개"), r("필기체쓰기", "1개")] },
  ] },
  // 김건우 Dylan
  "35": { sections: [
    { title: DAILY, rows: [r("원서 읽고 독서기록장 쓰기", "하루에 한 개 꼭!"), r("단어시험", "15개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료, Link 온라인 학습 1개 하기"), r("link 교재 Easy Link L5", "1 Unit씩"), r("필기체쓰기", "1개")] },
  ] },
  // 김민정
  "26": { sections: [
    { title: DAILY, rows: [r("원서 읽고 독서기록장 쓰기", "하루에 한 개 꼭!"), r("단어시험", "15개씩")] },
    { title: "순서대로 이어서 하기", rows: [r("class 5", "1개 학습 완료"), r("link 교재", "Easy Link L5"), r("필기체쓰기", "1개")] },
    { title: "추가 학습", rows: [r("class card 문법", "30"), r("reading tutor, Grammar 채점", "10"), r("Panda Writing / 기초 영문법", "30"), r("원서 읽고 독서기록장 쓰기", "남는시간")] },
  ] },
  // 김예건 Guny
  "31": { sections: [
    { title: DAILY, rows: [r("단어시험", "뜻쓰기 30개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료, Link 온라인 학습 1개 하기"), r("link 교재", "Easy Link level 4, 1 Unit씩"), r("원서 읽고 독서기록장 쓰기", "1개"), r("판다라이팅", "1 Unit씩")] },
  ] },
  // 김예담 Ivan
  "28": { sections: [
    { title: DAILY, rows: [r("단어시험", "30개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료 후 Link 온라인 학습하기"), r("link 교재", "Insight Link level 1"), r("원서 읽고 독서기록장 쓰기 (마지막 번호쓰기)", "1개"), r("기초 영문법", "1개")] },
  ] },
  // 노유찬 Michael
  "30": { sections: [
    { title: DAILY, rows: [r("단어시험", "15개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료, Link 온라인 학습 1개 하기"), r("link 교재", "1 Unit씩"), r("원서 읽고 독서기록장 쓰기", "1개"), r("판다라이팅", "1 Unit씩")] },
  ] },
  // 박성준
  "19": { sections: [
    { title: DAILY, rows: [r("단어시험", "30개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료, Link 온라인 학습 1개 하기"), r("link 교재", "1 Unit씩"), r("원서 읽고 독서기록장 쓰기", "1개"), r("판다라이팅", "1 Unit씩"), r("필기체 쓰기", "남는시간")] },
  ] },
  // 김예원 Sophia
  "27": { sections: [
    { title: DAILY, rows: [r("단어시험", "15개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료, Link 온라인 학습 1개 하기"), r("link 교재", "Insight Link starter2, 1 Unit씩"), r("원서 읽고 독서기록장 쓰기", "1개"), r("영문법 똑똑한 하루 grammar", "1 Unit씩"), r("필기체 쓰기", "끝")] },
  ] },
  // 박재이
  "3": { sections: [
    { title: DAILY, rows: [r("단어시험", "15개씩"), r("영어타자연습 (수)", "1개")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료, Link 온라인 학습 1개 하기"), r("원서 읽고 독서기록장 쓰기", "1개"), r("Core Phonics 4/5", "1 Unit씩"), r("필기체 쓰기", "남는시간")] },
  ] },
  // 윤하영
  "14": { sections: [
    { title: "매일 반복", rows: [r("단어시험", "25개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료 후 Link 온라인 학습 완료하기"), r("link 교재", "Easy Link L5, 1 Unit 끝내기"), r("원서 읽고 독서기록장 쓰기", "1권"), r("Panda writing", "1 Unit 끝내기")] },
  ] },
  // 정시우
  "4": { sections: [
    { title: DAILY, rows: [r("단어시험", "30개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료 후 Link 온라인 학습하기"), r("link 교재", ""), r("원서 읽고 독서기록장 쓰기 (마지막 번호쓰기)", "1개"), r("기초 영문법", "1개"), r("필기체쓰기", "1개")] },
  ] },
  // 정시원
  "5": { sections: [
    { title: DAILY, rows: [r("단어시험", "30개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료 후 Link 온라인 학습하기"), r("link 교재", "Insight Link Starter L3 → Subject Link Starter L1"), r("원서 읽고 독서기록장 쓰기 (마지막 번호쓰기)", "1개"), r("기초 영문법", "1개"), r("필기체쓰기", "")] },
  ] },
  // 조민아
  "25": { sections: [
    { title: DAILY, rows: [r("단어시험", "뜻쓰기 30개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료, Link 온라인 학습 1개 하기"), r("link 교재", "Easy Link 4 → Insight Link 2"), r("원서 읽고 독서기록장 쓰기", "주황색 이상, 1개"), r("기초영문법", "1개"), r("필기체쓰기", "1개")] },
  ] },
  // 최다연 Stella
  "6": { sections: [
    { title: DAILY, rows: [r("단어시험", "15개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료, Link 온라인 학습 1개 하기"), r("link 교재", "1 Unit씩"), r("원서 읽고 독서기록장 쓰기", "1개"), r("판다라이팅", "1 Unit씩"), r("영문법 - 만점왕", "1 Unit씩")] },
  ] },
  // 권하진
  "49": { sections: [
    { title: DAILY, rows: [r("단어시험", "20개씩 주관식"), r("자판 연습하기", "매일 1개씩")] },
    { title: CONT, rows: [r("class 5", "1개 학습 완료 + Link 온라인 학습"), r("link 교재", "Insight Link starter L1"), r("원서 읽고 독서기록장 쓰기 (마지막 번호쓰기)", ""), r("기초 영문법", ""), r("필기체쓰기", "")] },
  ] },
};

const ts = Date.now();
const esc = (s) => s.replace(/'/g, "''");
const lines = [];
for (const [sid, v] of Object.entries(DATA)) {
  const payload = JSON.stringify({ note: NOTE, sections: v.sections });
  lines.push(
    `INSERT INTO class_eng_curriculum(student_id,items,updated_at) VALUES('${sid}','${esc(payload)}',${ts}) ` +
      `ON CONFLICT(student_id) DO UPDATE SET items=excluded.items, updated_at=excluded.updated_at;`
  );
}
const sql = lines.join("\n") + "\n";
writeFileSync("/tmp/cur.sql", sql);
console.log(`${lines.length} statements → /tmp/cur.sql`);
