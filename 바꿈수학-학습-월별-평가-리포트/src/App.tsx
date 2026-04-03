import React, { useState, useRef } from 'react';
import { 
  BookOpen, Calendar as CalendarIcon, User, Download, Upload, Settings, X, CheckCircle, 
  BarChart2, FileText, CheckCircle2, AlertCircle, Clock, MessageCircle, SplitSquareVertical
} from 'lucide-react';
import * as htmlToImage from 'html-to-image';
import download from 'downloadjs';

const sanitizeData = (rawData: any) => {
  if (!rawData) return rawData;
  const newData = { ...rawData };
  
  if (typeof newData["출석부"] === 'string') {
    const lines = newData["출석부"].split('\n').filter((l: string) => l.trim() !== '');
    newData["출석부"] = lines.map((line: string) => {
      const parts = line.split(':').map((p: string) => p.trim());
      if (parts.length >= 2) {
        const date = parts[0];
        const rest = parts.slice(1).join(':').trim();
        let status = rest;
        let memo = "";
        
        if (rest.includes('-')) {
          const dashIdx = rest.indexOf('-');
          status = rest.substring(0, dashIdx).trim();
          memo = rest.substring(dashIdx + 1).trim();
        } else if (rest.includes(' ') && (rest.startsWith('출석') || rest.startsWith('결석') || rest.startsWith('보강'))) {
          const spaceIdx = rest.indexOf(' ');
          status = rest.substring(0, spaceIdx).trim();
          memo = rest.substring(spaceIdx + 1).trim();
        }
        return { "날짜": date, "상태": status, "메모": memo };
      }
      return { "날짜": "", "상태": "알수없음", "메모": line };
    });
  }
  return newData;
};

// 한글화된 양식 데이터 세팅
const defaultData = {
  "학생이름": "이름입력",
  "평가월": "2026년 3월",
  "코멘트": "이번 달도 성실하게 잘 해주었어요! 앞으로도 화이팅입니다.",
  "진도현황": {
    "현재진도": "6단원 입체도형의 겉넓이와 부피",
    "영역": "개념",
    "시작일": "2026-03-20",
    "진행률": "80%"
  },
  "출석부": [
    { "날짜": "03/03", "상태": "출석", "메모": "" },
    { "날짜": "03/04", "상태": "출석", "메모": "등원 전" },
    { "날짜": "03/06", "상태": "지각", "메모": "30분 지각" },
    { "날짜": "03/10", "상태": "보강", "메모": "보강 1시간" },
    { "날짜": "03/13", "상태": "결석", "메모": "가족 행사" },
    { "날짜": "03/17", "상태": "결석", "메모": "감기 몸살" },
    { "날짜": "03/19", "상태": "지각", "메모": "10분 지각" },
    { "날짜": "03/24", "상태": "출석", "메모": "" },
    { "날짜": "03/31", "상태": "출석", "메모": "" }
  ],
  "시험성적": [
    { "날짜": "2026-03-04", "시험유형": "주간평가", "회차": "3월 1주차", "범위": "4단원", "점수": "50점", "상태": "완료" },
    { "날짜": "2026-03-10", "시험유형": "주간평가", "회차": "3월 2주차", "범위": "4단원", "점수": "65점", "상태": "완료" },
    { "날짜": "2026-03-18", "시험유형": "수학경시대회", "회차": "1차", "범위": "1단원", "점수": "37점", "상태": "결과대기" }
  ],
  "숙제상태": [
    { "날짜": "03/03", "완성도": "100%", "상태": "완벽 (완료)", "교재": "개념편", "영역": "개념", "코멘트": "꾸준히 잘 하고 있어요! 칭찬합니다." },
    { "날짜": "03/04", "완성도": "70%", "상태": "보통 (완료)", "교재": "유형편, 복습편", "영역": "복습", "코멘트": "" },
    { "날짜": "03/10", "완성도": "80%", "상태": "양호 (완료)", "교재": "서술형문제지", "영역": "개념, 복습", "코멘트": "서술형 풀이 과정을 조금 더 꼼꼼히 적어주세요." },
    { "날짜": "03/13", "완성도": "100%", "상태": "완결 (완료)", "교재": "주간TEST", "영역": "오답", "코멘트": "오답 노트 정리가 아주 훌륭합니다." },
    { "날짜": "03/18", "완성도": "100%", "상태": "완결 (결석)", "교재": "서술형문제지", "영역": "복습, 서술형", "코멘트": "" },
    { "날짜": "03/24", "완성도": "80%", "상태": "양호 (완료)", "교재": "매쓰홀릭", "영역": "단원평가 대비", "코멘트": "어려운 문제도 스스로 깊게 고민하는 모습이 매우 보기 좋습니다." },
    { "날짜": "03/31", "완성도": "100%", "상태": "완벽 (완료)", "교재": "매쓰홀릭", "영역": "개념, 공식 암기", "코멘트": "공식 암기 완벽합니다!" }
  ]
};

export default function App() {
  const [data, setData] = useState<any>(defaultData);
  const [isEditing, setIsEditing] = useState(false);
  const [jsonInput, setJsonInput] = useState(JSON.stringify(defaultData, null, 2));
  
  // 분할 저장을 위한 2개의 Ref
  const page1Ref = useRef<HTMLDivElement>(null);
  const page2Ref = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  
  let displayMonth = data["평가월"];
  if (!displayMonth || displayMonth.trim() === "") {
    let year = new Date().getFullYear();
    if (data["진도현황"]?.["시작일"]) {
      const match = String(data["진도현황"]["시작일"]).match(/\d{4}/);
      if (match) year = Number(match[0]);
    } else if (data["시험성적"]?.length > 0) {
      const match = String(data["시험성적"][0]["날짜"]).match(/\d{4}/);
      if (match) year = Number(match[0]);
    }
    let month = new Date().getMonth() + 1;
    if (data["출석부"]?.length > 0) {
      const firstDate = String(data["출석부"][0]["날짜"]);
      const match = firstDate.match(/(\d{1,2})\/\d{1,2}/);
      if (match) month = Number(match[1]);
    }
    displayMonth = `${year}년 ${month}월`;
  }

  const handleExportImage = async () => {
    if (!page1Ref.current || !page2Ref.current) return;
    setIsExporting(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const captureAndDownload = async (element: HTMLElement, filename: string) => {
        const dataUrl = await htmlToImage.toPng(element, {
          pixelRatio: 2,
          backgroundColor: '#ffffff'
        });
        download(dataUrl, filename);
      };

      await captureAndDownload(page1Ref.current, `${data["학생이름"] || '학생'}_${displayMonth}_평가리포트_1장.png`);
      await new Promise(resolve => setTimeout(resolve, 500));
      await captureAndDownload(page2Ref.current, `${data["학생이름"] || '학생'}_${displayMonth}_평가리포트_2장.png`);
      
    } catch (error) {
      alert('이미지 저장에 실패했습니다: ' + String(error));
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        const sanitized = sanitizeData(parsed);
        setData(sanitized);
        setJsonInput(JSON.stringify(sanitized, null, 2));
      } catch (err) {
        alert('올바른 JSON 파일이 아닙니다.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleApplyJson = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      const sanitized = sanitizeData(parsed);
      setData(sanitized);
      setIsEditing(false);
    } catch (err) {
      alert('데이터 양식 오류: 쉼표나 괄호를 확인해주세요.');
    }
  };

  const parsePercent = (str: string) => {
    return parseInt(str.replace('%', '')) || 0;
  };

  // 숙제 기록 날짜순 정렬 (오름차순)
  const sortedHomeworks = [...(data["숙제상태"] || [])].sort((a, b) => {
    return a["날짜"].localeCompare(b["날짜"]);
  });

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center font-sans py-10 px-4">
      
      {/* 관리자 컨트롤 패널 */}
      <div className="w-full max-w-[1100px] bg-white rounded-2xl shadow-md p-6 mb-8 z-50 flex flex-col md:flex-row gap-4 items-center justify-between border-l-4 border-slate-800">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">📊 고화질 리포트 생성기</h2>
          <p className="text-base text-slate-500 mt-1">글씨가 깨지지 않게 2장(상/하단)으로 나뉘어 고해상도로 자동 저장됩니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-800 px-5 py-3 rounded-xl text-base font-bold flex items-center gap-2 transition-colors">
            <Upload className="w-5 h-5" /> 양식 파일(.json) 업로드
            <input type="file" accept=".json" className="hidden" onChange={handleFileUpload} />
          </label>
          <button onClick={() => {
            setJsonInput("");
            setIsEditing(true);
          }} className="bg-slate-100 hover:bg-slate-200 text-slate-800 px-5 py-3 rounded-xl text-base font-bold flex items-center gap-2 transition-colors">
            <Settings className="w-5 h-5" /> 텍스트 붙여넣기
          </button>
          <button 
            onClick={handleExportImage} 
            disabled={isExporting}
            className={`${isExporting ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'} text-white px-6 py-3 rounded-xl text-base font-bold flex items-center gap-2 shadow-lg transition-colors`}
          >
            {isExporting ? <Clock className="w-5 h-5 animate-spin" /> : <SplitSquareVertical className="w-5 h-5" />} 
            {isExporting ? '저장 중...' : '매직 분할 저장 (1번, 2번 저장)'}
          </button>
        </div>
      </div>

      {/* JSON 텍스트 에디터 모달 */}
      {isEditing && (
        <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-4xl flex flex-col overflow-hidden shadow-2xl">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="font-bold text-slate-800 text-xl flex items-center gap-2">
                <Settings className="w-6 h-6 text-indigo-600" /> 데이터 직접 수정 붙여넣기
              </h2>
              <button onClick={() => setIsEditing(false)} className="p-2 bg-slate-200 hover:bg-slate-300 rounded-full transition-colors">
                <X className="w-6 h-6 text-slate-600" />
              </button>
            </div>
            <div className="p-8 flex-1 flex flex-col bg-slate-50">
              <div className="mb-4 text-base text-indigo-800 bg-indigo-50 p-4 rounded-xl border border-indigo-100 font-medium">
                💡 <b>안내:</b> 위쪽 형식대로 "코멘트" 나 "메모" 항목을 자유롭게 추가해보세요!
              </div>
              <textarea 
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="w-full h-[32rem] p-6 bg-white border border-slate-300 rounded-2xl font-mono text-base text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none shadow-inner"
                spellCheck={false}
              />
            </div>
            <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3">
              <button onClick={() => setIsEditing(false)} className="px-8 py-3 rounded-xl text-base font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
                취소
              </button>
              <button onClick={handleApplyJson} className="px-8 py-3 rounded-xl text-base font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md transition-colors">
                리포트에 적용하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 리포트 캔버스 */}
      <div className="w-full flex flex-col items-center pb-20 overflow-x-auto gap-12">
        
        {/* ================= PAGE 1 ================= */}
        <div ref={page1Ref} className="w-[1100px] bg-[#fdfdfd] shadow-2xl relative overflow-hidden shrink-0 border border-slate-200 rounded-3xl">
          
          {/* Header */}
          <header className="bg-slate-900 px-14 pt-20 pb-16 relative z-10 overflow-hidden">
            <div className={`absolute top-0 right-0 w-80 h-80 bg-indigo-500/20 rounded-full ${isExporting ? '' : 'blur-3xl'} -mr-10 -mt-20`}></div>
            <div className={`absolute bottom-0 left-0 w-96 h-96 bg-blue-500/20 rounded-full ${isExporting ? '' : 'blur-3xl'} -ml-20 -mb-40`}></div>
            
            <div className="relative flex justify-between items-start">
              <div>
                <div className="flex items-center gap-4 mb-6">
                  <span className="bg-indigo-500 text-white px-4 py-1.5 pb-2 rounded-full text-base font-bold tracking-wider">바꿈수학</span>
                  <span className="text-slate-300 font-medium text-lg tracking-widest">{displayMonth} 첫 번째 장</span>
                </div>
                <h1 className="text-6xl font-extrabold text-white tracking-tight leading-snug">
                  <span className="text-indigo-400 border-b-4 border-indigo-400 pb-2 mr-3">{data["학생이름"]}</span>학생
                  <br/>월간 학습 종합 현황
                </h1>
              </div>
              <div className={`w-32 h-32 bg-white/10 ${isExporting ? '' : 'backdrop-blur-md'} rounded-3xl border border-white/20 flex items-center justify-center text-white shadow-xl rotate-3`}>
                <User className="w-16 h-16" />
              </div>
            </div>
          </header>

          <main className="px-14 py-14 space-y-16">
            
            {/* 0. 선생님 종합 코멘트 */}
            {data["코멘트"] && (
              <section>
                <div className="bg-indigo-50/50 rounded-[2rem] p-10 border border-indigo-100 shadow-sm relative overflow-hidden">
                  <div className={`absolute -right-6 -bottom-6 w-40 h-40 bg-indigo-200/40 rounded-full ${isExporting ? '' : 'blur-3xl'}`}></div>
                  <div className="flex items-start gap-6 relative z-10">
                    <div className="bg-indigo-100 p-4 rounded-2xl shrink-0">
                      <MessageCircle className="w-10 h-10 text-indigo-600" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-extrabold text-indigo-900 mb-2">선생님 종합 코멘트</h2>
                      <p className="text-xl font-bold text-slate-700 leading-relaxed max-w-4xl break-keep whitespace-pre-wrap">
                        {data["코멘트"]}
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* 1. 현재 진도 및 성취도 현황 */}
            <section>
              <div className="flex items-center gap-4 mb-8 border-b-2 border-slate-100 pb-4">
                <BarChart2 className="w-9 h-9 text-indigo-600" />
                <h2 className="text-3xl font-bold text-slate-800">진도 달성 현황</h2>
              </div>
              
              <div className="bg-white rounded-[2rem] p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex items-center gap-12">
                <div className="w-44 h-44 relative shrink-0">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                    <path stroke="#f1f5f9" strokeWidth="3.5" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <path stroke="#4f46e5" className="drop-shadow-md transition-all duration-1000 ease-out" strokeDasharray={`${parsePercent(data["진도현황"]["진행률"])}, 100`} strokeWidth="3.5" strokeLinecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-4xl font-black text-slate-800 tracking-tighter">{data["진도현황"]["진행률"]}</span>
                    <span className="text-xs font-bold text-slate-500 tracking-widest mt-1">달성률</span>
                  </div>
                </div>

                <div className="flex-1 space-y-6">
                  <div>
                    <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-4 py-1.5 rounded-lg mb-3 inline-block">현재 학습 단원</span>
                    <h3 className="text-3xl font-bold text-slate-800 leading-snug">{data["진도현황"]["현재진도"]}</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-100">
                    <div>
                      <p className="text-sm text-slate-400 font-medium mb-1.5">학습 영역</p>
                      <p className="text-xl font-bold text-slate-700">{data["진도현황"]["영역"]}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400 font-medium mb-1.5">학습 시작일</p>
                      <p className="text-xl font-bold text-slate-700">{data["진도현황"]["시작일"]}</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. 출석부 */}
            <section>
              <div className="flex items-center gap-4 mb-8 border-b-2 border-slate-100 pb-4">
                <CalendarIcon className="w-9 h-9 text-amber-500" />
                <h2 className="text-3xl font-bold text-slate-800">월간 출결 현황</h2>
              </div>
              
              <div className="bg-white rounded-[2rem] p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
                 <div className="flex flex-wrap gap-4">
                    {data["출석부"]?.map((att: any, idx: number) => {
                       let dotColor = "bg-emerald-500";
                       let badgeColor = "bg-emerald-50 text-emerald-700 ring-emerald-100";
                       let isNoticeable = false;

                       if(att["상태"]?.includes?.("결석") || att["상태"] === "결석") {
                         dotColor = "bg-red-500"; badgeColor = "bg-red-50 text-red-800 ring-red-200 border-red-100 bg-gradient-to-br from-white to-red-50";
                         isNoticeable = true;
                       } else if(att["상태"]?.includes?.("보강") || att["상태"] === "보강") {
                         dotColor = "bg-blue-500"; badgeColor = "bg-blue-50 text-blue-800 ring-blue-200 border-blue-100 bg-gradient-to-br from-white to-blue-50";
                         isNoticeable = true;
                       } else if(att["상태"]?.includes?.("지각")) {
                         dotColor = "bg-amber-500"; badgeColor = "bg-amber-50 text-amber-800 ring-amber-200 border-amber-100 bg-gradient-to-br from-white to-amber-50";
                         isNoticeable = true;
                       }
                       
                       return (
                         <div key={idx} className={`flex flex-col gap-1 px-5 py-4 rounded-2xl border ring-inset ring-1 ${badgeColor} shadow-sm min-w-[130px]`}>
                           <div className="flex items-center gap-3 mb-1">
                             <div className={`w-3.5 h-3.5 rounded-full ${dotColor} shadow-inner`}></div>
                             <span className="text-xl font-bold whitespace-nowrap">{att["날짜"]}</span>
                           </div>
                           <span className="text-sm font-extrabold opacity-75 uppercase tracking-wider">{att["상태"]}</span>
                           
                           {att["메모"] && (
                             <span className={`text-sm font-bold opacity-100 mt-2 px-2.5 py-1.5 rounded-lg inline-block text-center shadow-sm ${isNoticeable ? 'bg-white text-inherit border border-inherit' : 'bg-white/70 text-slate-600 border border-white/50'}`}>
                               💬 {att["메모"]}
                             </span>
                           )}
                         </div>
                       )
                    })}
                 </div>
              </div>
            </section>

             {/* 3. 주간/단원 평가 성적 */}
             <section>
              <div className="flex items-center justify-between mb-8 border-b-2 border-slate-100 pb-4">
                <div className="flex items-center gap-4">
                  <CheckCircle2 className="w-9 h-9 text-emerald-600" />
                  <h2 className="text-3xl font-bold text-slate-800">평가 결과 상세</h2>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-8">
                {data["시험성적"]?.map((test: any, idx: number) => (
                  <div key={idx} className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-bl-full -mr-6 -mt-6 transition-transform group-hover:scale-110"></div>
                    <div className="relative z-10 flex flex-col h-full justify-between gap-8">
                      <div>
                        <div className="flex justify-between items-start mb-3">
                          <span className="text-sm font-extrabold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg">{test["날짜"]}</span>
                          <span className="text-sm font-bold text-emerald-700 bg-emerald-100 px-3 py-1.5 rounded-lg">{test["상태"]}</span>
                        </div>
                        <h3 className="font-bold text-slate-800 text-2xl mb-1.5">{test["시험유형"]}</h3>
                        <p className="text-base text-slate-500">{test["회차"]} • {test["범위"]}</p>
                      </div>
                      <div className="text-right mt-2">
                        <span className="text-5xl font-black text-emerald-600 tracking-tighter">
                          {test["점수"].replace('점','')}
                        </span>
                        <span className="text-xl text-emerald-600/60 font-medium ml-1">점</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

          </main>
          
          <footer className="w-full text-center pb-10 pt-4">
             <div className="inline-block w-16 h-1 bg-slate-200 rounded-full mb-5"></div>
             <p className="text-base font-bold text-slate-400">바꿈수학학원</p>
          </footer>
        </div>


        {/* ================= PAGE 2 ================= */}
        <div ref={page2Ref} className="w-[1100px] bg-[#fdfdfd] shadow-2xl relative overflow-hidden shrink-0 border border-slate-200 rounded-3xl mt-4">
          
          <header className="bg-indigo-600 px-14 pt-16 pb-12 relative z-10 overflow-hidden flex justify-between items-center shadow-md">
            <h1 className="text-4xl font-extrabold text-white tracking-tight leading-snug">
              숙제 및 수행 기록 상세 (2/2)
            </h1>
            <FileText className="w-12 h-12 text-white/20" />
          </header>

          <main className="px-14 py-14">
            
            <section>              
              <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200 overflow-hidden">
                <table className="w-full text-left table-fixed">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-base border-b-2 border-slate-200">
                      <th className="py-6 px-8 font-extrabold whitespace-nowrap w-36">날짜</th>
                      <th className="py-6 px-4 font-extrabold w-1/4">사용 교재</th>
                      <th className="py-6 px-4 font-extrabold w-1/4">학습 영역</th>
                      <th className="py-6 px-4 font-extrabold text-center w-36">완성도</th>
                      <th className="py-6 px-8 font-extrabold text-center w-40">검사 상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 border-x border-slate-100">
                    {sortedHomeworks.map((hw: any, idx: number) => {
                      const percent = parsePercent(hw["완성도"]);
                      let stampColor = "bg-slate-100 text-slate-600";
                      if (!hw || !hw["상태"]) return null;
                      
                      let displayStatus = hw["상태"];
                      // 긴 상태 텍스트를 깔끔한 단어로 통일
                      if (displayStatus.includes("완료") || displayStatus.includes("완벽") || displayStatus.includes("양호") || displayStatus.includes("보통") || displayStatus.includes("완결")) {
                        displayStatus = "검사 완료";
                        stampColor = "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200";
                      } else if (displayStatus.includes("결석")) {
                        displayStatus = "결석";
                        stampColor = "bg-slate-50 text-slate-500 ring-1 ring-slate-200";
                      } else if (displayStatus.includes("미제출") || displayStatus.includes("미흡")) {
                        displayStatus = "미제출";
                        stampColor = "bg-red-100 text-red-700 ring-1 ring-red-200";
                      } else {
                        displayStatus = displayStatus.replace(/\s*\([^)]*\)\s*/g, ''); // 괄호 제거
                      }
                      
                      return (
                        <React.Fragment key={idx}>
                          {/* 1. 숙제 상태 본문 */}
                          <tr className="hover:bg-slate-50/50 transition-colors bg-white">
                            <td className="py-8 px-8 text-xl font-bold text-slate-500">{hw["날짜"]}</td>
                            <td className="py-8 px-4 text-xl font-bold text-slate-800 break-keep">{hw["교재"]}</td>
                            <td className="py-8 px-4 text-xl text-slate-600 font-medium break-keep">{hw["영역"]}</td>
                            <td className="py-8 px-4">
                              <div className="flex flex-col items-center gap-2 justify-center">
                                <span className="text-xl font-bold text-slate-700 text-center tracking-tighter">{hw["완성도"]}</span>
                                <div className="w-24 h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                                  <div className={`h-full rounded-full ${percent >= 90 ? 'bg-indigo-500' : percent >= 70 ? 'bg-emerald-400' : 'bg-amber-400'}`} style={{ width: `${percent}%` }}></div>
                                </div>
                              </div>
                            </td>
                            <td className="py-8 px-8 text-center">
                              <span className={`text-base font-bold px-5 py-2.5 rounded-xl inline-block shadow-sm whitespace-nowrap break-keep ${stampColor}`}>
                                {displayStatus}
                              </span>
                            </td>
                          </tr>
                          {/* 2. 선생님 코멘트 (있는 경우에만 렌더링) */}
                          {hw["코멘트"] && hw["코멘트"].trim() !== "" && (
                            <tr className="bg-slate-50/30">
                              <td colSpan={5} className="py-4 px-10 border-b border-slate-100 pb-8">
                                <div className="flex items-start gap-4 p-6 bg-indigo-50/60 rounded-2xl border border-indigo-100 shadow-sm relative overflow-hidden">
                                  <div className={`absolute top-0 right-0 w-32 h-32 bg-indigo-100/50 rounded-full ${isExporting ? '' : 'blur-2xl'} -mr-10 -mt-10`}></div>
                                  <MessageCircle className="w-8 h-8 text-indigo-500 shrink-0 mt-0.5 relative z-10" />
                                  <div className="relative z-10 flex-1">
                                    <span className="text-sm font-bold text-indigo-400 mb-1.5 block tracking-wide">Teacher's Comment</span>
                                    <p className="text-xl font-bold text-indigo-900 leading-relaxed max-w-4xl break-keep">
                                      {hw["코멘트"]}
                                    </p>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

          </main>
          
          <footer className="w-full text-center pb-12 pt-4">
             <div className="inline-block w-16 h-1 bg-slate-200 rounded-full mb-5"></div>
             <p className="text-base font-bold text-slate-400">바꿈수학학원</p>
          </footer>
        </div>

      </div>
    </div>
  );
}
