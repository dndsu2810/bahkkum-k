import React, { useState, useRef } from 'react';
import { 
  BookOpen, Calendar as CalendarIcon, User, Download, Upload, Settings, X, CheckCircle, 
  BarChart2, FileText, CheckCircle2, AlertCircle, Clock
} from 'lucide-react';
import html2canvas from 'html2canvas';

// 한글화된 양식 데이터 세팅
const defaultData = {
  "학생이름": "이름입력",
  "평가월": "2026년 3월",
  "진도현황": {
    "현재진도": "6단원 입체도형의 겉넓이와 부피",
    "영역": "개념",
    "시작일": "2026-03-20",
    "진행률": "80%"
  },
  "숙제상태": [
    { "날짜": "03/03", "완성도": "100%", "상태": "검사 완료", "교재": "복습편", "영역": "복습" },
    { "날짜": "03/04", "완성도": "70%", "상태": "보통 (완료)", "교재": "유형편, 복습편", "영역": "복습" },
    { "날짜": "03/10", "완성도": "80%", "상태": "양호 (완료)", "교재": "서술형문제지", "영역": "개념, 복습" },
    { "날짜": "03/11", "완성도": "100%", "상태": "완벽 (완료)", "교재": "개념편", "영역": "복습" },
    { "날짜": "03/12", "완성도": "100%", "상태": "완벽 (완료)", "교재": "개념편", "영역": "개념" },
    { "날짜": "03/13", "완성도": "100%", "상태": "완벽 (완료)", "교재": "주간TEST", "영역": "오답" },
    { "날짜": "03/18", "완성도": "100%", "상태": "완벽 (결석)", "교재": "서술형문제지", "영역": "복습, 서술형" },
    { "날짜": "03/20", "완성도": "100%", "상태": "완벽 (완료)", "교재": "서술형문제지", "영역": "서술형" },
    { "날짜": "03/24", "완성도": "80%", "상태": "양호 (완료)", "교재": "매쓰홀릭", "영역": "단원평가 대비" },
    { "날짜": "03/27", "완성도": "80%", "상태": "양호 (완료)", "교재": "서술형문제지", "영역": "서술형" },
    { "날짜": "03/31", "완성도": "100%", "상태": "완벽 (완료)", "교재": "매쓰홀릭", "영역": "개념, 공식 암기" }
  ],
  "출석부": [
    { "날짜": "03/03", "상태": "출석" },
    { "날짜": "03/03", "상태": "보강" },
    { "날짜": "03/04", "상태": "출석" },
    { "날짜": "03/05", "상태": "출석" },
    { "날짜": "03/06", "상태": "출석" },
    { "날짜": "03/09", "상태": "보강" },
    { "날짜": "03/10", "상태": "출석" },
    { "날짜": "03/11", "상태": "출석" },
    { "날짜": "03/12", "상태": "출석" },
    { "날짜": "03/13", "상태": "출석" },
    { "날짜": "03/17", "상태": "결석" },
    { "날짜": "03/18", "상태": "출석" },
    { "날짜": "03/18", "상태": "보강" },
    { "날짜": "03/19", "상태": "출석" },
    { "날짜": "03/20", "상태": "출석" },
    { "날짜": "03/24", "상태": "출석" },
    { "날짜": "03/24", "상태": "보강" },
    { "날짜": "03/25", "상태": "출석" },
    { "날짜": "03/26", "상태": "결석" },
    { "날짜": "03/27", "상태": "출석" },
    { "날짜": "03/31", "상태": "출석" }
  ],
  "시험성적": [
    { "날짜": "2026-03-04", "시험유형": "주간평가", "회차": "3월 1주차", "범위": "4단원", "점수": "50점", "상태": "완료" },
    { "날짜": "2026-03-10", "시험유형": "주간평가", "회차": "3월 2주차", "범위": "4단원", "점수": "65점", "상태": "완료" },
    { "날짜": "2026-03-18", "시험유형": "수학경시대회", "회차": "1차", "범위": "1단원", "점수": "37점", "상태": "완료" },
    { "날짜": "2026-03-25", "시험유형": "TOMA 경시대회", "회차": "3월", "범위": "1단원", "점수": "24점", "상태": "완료" }
  ]
};

export default function App() {
  const [data, setData] = useState<any>(defaultData);
  const [isEditing, setIsEditing] = useState(false);
  const [jsonInput, setJsonInput] = useState(JSON.stringify(defaultData, null, 2));
  const reportRef = useRef<HTMLDivElement>(null);

  const handleExportImage = async () => {
    if (!reportRef.current) return;
    try {
      await new Promise(resolve => setTimeout(resolve, 100)); // 폰트 대기 딜레이
      const canvas = await html2canvas(reportRef.current, {
        scale: 2, 
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const image = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = image;
      link.download = `${data["학생이름"]}_${data["평가월"]}_평가리포트.png`;
      link.click();
    } catch (error) {
      alert('이미지 저장에 실패했습니다.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        setData(parsed);
        setJsonInput(JSON.stringify(parsed, null, 2));
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
      setData(parsed);
      setIsEditing(false);
    } catch (err) {
      alert('데이터 양식 오류: 쉼표나 괄호를 확인해주세요.');
    }
  };

  const parsePercent = (str: string) => {
    return parseInt(str.replace('%', '')) || 0;
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center font-sans py-10 px-4">
      
      {/* 관리자 컨트롤 패널 */}
      <div className="w-full max-w-[850px] bg-white rounded-2xl shadow-md p-6 mb-8 z-50 flex flex-col md:flex-row gap-4 items-center justify-between border-l-4 border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-slate-800">📊 리포트 생성기</h2>
          <p className="text-sm text-slate-500 mt-1">입력된 데이터를 바탕으로 리포트 이미지를 만듭니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer bg-slate-100 hover:bg-slate-200 text-slate-800 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors">
            <Upload className="w-4 h-4" /> 양식 파일(.json) 업로드
            <input type="file" accept=".json" className="hidden" onChange={handleFileUpload} />
          </label>
          <button onClick={() => setIsEditing(true)} className="bg-slate-100 hover:bg-slate-200 text-slate-800 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors">
            <Settings className="w-4 h-4" /> 텍스트로 직접 붙여넣기
          </button>
          <button onClick={handleExportImage} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg transition-colors">
            <Download className="w-4 h-4" /> 리포트 이미지 저장
          </button>
        </div>
      </div>

      {/* JSON 텍스트 에디터 모달 */}
      {isEditing && (
        <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-3xl flex flex-col overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-600" /> 데이터 직접 수정 붙여넣기
              </h2>
              <button onClick={() => setIsEditing(false)} className="p-2 bg-slate-200 hover:bg-slate-300 rounded-full transition-colors">
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>
            <div className="p-6 flex-1 flex flex-col bg-slate-50">
              <div className="mb-4 text-sm text-indigo-800 bg-indigo-50 p-3 rounded-lg border border-indigo-100 font-medium">
                💡 <b>안내:</b> 채팅창에서 전달받은 양식 코드를 이곳에 그대로 복사(Ctrl+C)하여 덮어쓰기(Ctrl+V) 해주세요.
              </div>
              <textarea 
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="w-full h-80 p-5 bg-white border border-slate-300 rounded-xl font-mono text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none shadow-inner"
                spellCheck={false}
              />
            </div>
            <div className="p-5 border-t border-slate-100 bg-white flex justify-end gap-3">
              <button onClick={() => setIsEditing(false)} className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
                취소
              </button>
              <button onClick={handleApplyJson} className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md transition-colors">
                리포트에 적용하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 리포트 캔버스 (여기부터 저장됨) */}
      <div className="w-full flex justify-center pb-20 overflow-x-auto">
        <div ref={reportRef} className="w-[850px] min-h-[1200px] bg-[#fdfdfd] shadow-2xl relative overflow-hidden shrink-0 border border-slate-200">
          
          {/* Header - 프리미엄 네이비 톤 */}
          <header className="bg-slate-900 px-12 pt-16 pb-14 relative z-10 overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl -mr-10 -mt-20"></div>
            <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl -ml-20 -mb-40"></div>
            
            <div className="relative flex justify-between items-start">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="bg-indigo-500 text-white px-3 py-1 pb-1.5 rounded-full text-sm font-bold tracking-wider">바꿈수학</span>
                  <span className="text-slate-300 font-medium tracking-widest">{data["평가월"]} 평가 리포트</span>
                </div>
                <h1 className="text-5xl font-extrabold text-white tracking-tight leading-snug">
                  <span className="text-indigo-400 border-b-4 border-indigo-400 pb-1 mr-2">{data["학생이름"]}</span>학생
                  <br/>월간 학습 현황
                </h1>
              </div>
              <div className="w-24 h-24 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20 flex items-center justify-center text-white shadow-xl rotate-3">
                <User className="w-12 h-12" />
              </div>
            </div>
          </header>

          <main className="px-12 py-10 space-y-12">
            
            {/* 1. 현재 진도 및 성취도 현황 */}
            <section>
              <div className="flex items-center gap-3 mb-6 border-b-2 border-slate-100 pb-3">
                <BarChart2 className="w-7 h-7 text-indigo-600" />
                <h2 className="text-2xl font-bold text-slate-800">진도 달성 현황</h2>
              </div>
              
              <div className="bg-white rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex items-center gap-10">
                {/* 도넛 그래프 모양 모방 */}
                <div className="w-36 h-36 relative shrink-0">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                    <path
                      className="text-slate-100"
                      strokeWidth="3.5"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      className="text-indigo-600 drop-shadow-md transition-all duration-1000 ease-out"
                      strokeDasharray={`${parsePercent(data["진도현황"]["진행률"])}, 100`}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-black text-slate-800 tracking-tighter">{data["진도현황"]["진행률"]}</span>
                    <span className="text-[10px] font-bold text-slate-500 tracking-widest mt-0.5">달성률</span>
                  </div>
                </div>

                <div className="flex-1 space-y-4">
                  <div>
                    <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-md mb-2 inline-block">현재 학습 단원</span>
                    <h3 className="text-xl font-bold text-slate-800 leading-snug">{data["진도현황"]["현재진도"]}</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                    <div>
                      <p className="text-xs text-slate-400 font-medium mb-1">학습 영역</p>
                      <p className="text-base font-bold text-slate-700">{data["진도현황"]["영역"]}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 font-medium mb-1">학습 시작일</p>
                      <p className="text-base font-bold text-slate-700">{data["진도현황"]["시작일"]}</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* 2. 주간/단원 평가 성적 */}
            <section>
              <div className="flex items-center justify-between mb-6 border-b-2 border-slate-100 pb-3">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-7 h-7 text-emerald-600" />
                  <h2 className="text-2xl font-bold text-slate-800">평가 결과 상세</h2>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-5">
                {data["시험성적"].map((test: any, idx: number) => (
                  <div key={idx} className="bg-white rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
                    <div className="relative z-10 flex flex-col h-full justify-between gap-6">
                      <div>
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-xs font-extrabold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md">{test["날짜"]}</span>
                          <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-md">{test["상태"]}</span>
                        </div>
                        <h3 className="font-bold text-slate-800 text-lg mb-1">{test["시험유형"]}</h3>
                        <p className="text-sm text-slate-500">{test["회차"]} • {test["범위"]}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-4xl font-black text-emerald-600 tracking-tighter">
                          {test["점수"].replace('점','')}
                        </span>
                        <span className="text-lg text-emerald-600/60 font-medium ml-1">점</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 3. 숙제/학습 참여도 상세 리포트 */}
            <section>
              <div className="flex items-center gap-3 mb-6 border-b-2 border-slate-100 pb-3">
                <FileText className="w-7 h-7 text-blue-600" />
                <h2 className="text-2xl font-bold text-slate-800">숙제 및 수행 기록</h2>
              </div>
              
              <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50 text-slate-500 text-sm border-b border-slate-100">
                      <th className="py-4 px-6 font-bold whitespace-nowrap w-24">날짜</th>
                      <th className="py-4 px-4 font-bold">사용 교재</th>
                      <th className="py-4 px-4 font-bold">학습 영역</th>
                      <th className="py-4 px-4 font-bold text-center">완성도</th>
                      <th className="py-4 px-6 font-bold text-center">검사 상태</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data["숙제상태"].map((hw: any, idx: number) => {
                      const percent = parsePercent(hw["완성도"]);
                      let stampColor = "bg-slate-100 text-slate-600";
                      if (hw["상태"].includes("완벽") || hw["상태"].includes("완료")) stampColor = "bg-indigo-100 text-indigo-700";
                      if (hw["상태"].includes("양호") || hw["상태"].includes("보통")) stampColor = "bg-emerald-100 text-emerald-700";
                      
                      return (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-4 px-6 text-sm font-bold text-slate-500">{hw["날짜"]}</td>
                          <td className="py-4 px-4 text-sm font-bold text-slate-800">{hw["교재"]}</td>
                          <td className="py-4 px-4 text-sm text-slate-600 font-medium">{hw["영역"]}</td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-3 justify-center">
                              <span className="text-sm font-bold text-slate-700 w-10 text-right">{hw["완성도"]}</span>
                              <div className="w-20 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${percent >= 90 ? 'bg-indigo-500' : percent >= 70 ? 'bg-emerald-400' : 'bg-amber-400'}`} style={{ width: `${percent}%` }}></div>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-6 text-center">
                            <span className={`text-xs font-bold px-3 py-1.5 rounded-lg inline-block ${stampColor}`}>
                              {hw["상태"]}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 4. 출석부 */}
            <section>
              <div className="flex items-center gap-3 mb-6 border-b-2 border-slate-100 pb-3">
                <CalendarIcon className="w-7 h-7 text-amber-500" />
                <h2 className="text-2xl font-bold text-slate-800">월간 출결 현황</h2>
              </div>
              
              <div className="bg-white rounded-3xl p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100">
                 <div className="flex flex-wrap gap-3">
                    {data["출석부"].map((att: any, idx: number) => {
                       let dotColor = "bg-emerald-500";
                       let badgeColor = "bg-emerald-50 text-emerald-700 ring-emerald-100";
                       if(att["상태"] === "결석") {
                         dotColor = "bg-red-500"; badgeColor = "bg-red-50 text-red-700 ring-red-100";
                       } else if(att["상태"] === "보강") {
                         dotColor = "bg-indigo-500"; badgeColor = "bg-indigo-50 text-indigo-700 ring-indigo-100";
                       }
                       
                       return (
                         <div key={idx} className={`flex items-center gap-2 px-4 py-3 rounded-xl border ring-1 ring-inset ${badgeColor} border-white shadow-sm`}>
                           <div className={`w-2.5 h-2.5 rounded-full ${dotColor} shadow-sm`}></div>
                           <div className="flex flex-col">
                             <span className="text-[10px] font-extrabold opacity-70 uppercase tracking-wider mb-0.5">{att["상태"]}</span>
                             <span className="text-base font-bold whitespace-nowrap">{att["날짜"]}</span>
                           </div>
                         </div>
                       )
                    })}
                 </div>
              </div>
            </section>

          </main>
          
          <footer className="w-full text-center pb-8 pt-4">
             <div className="inline-block w-12 h-1 bg-slate-200 rounded-full mb-4"></div>
             <p className="text-sm font-bold text-slate-400">바꿈수학학원</p>
          </footer>
        </div>
      </div>
    </div>
  );
}
