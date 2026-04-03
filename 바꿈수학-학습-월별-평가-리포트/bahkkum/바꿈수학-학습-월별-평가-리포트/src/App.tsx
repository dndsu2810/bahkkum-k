import React, { useState, useRef } from 'react';
import { 
  BookOpen, 
  Calendar as CalendarIcon, 
  User, 
  MessageCircle,
  AlertCircle,
  Maximize2,
  Download,
  Upload,
  Settings,
  X
} from 'lucide-react';
import html2canvas from 'html2canvas';

// --- Default Data ---
const defaultData = {
  studentName: "박재이",
  month: "3월",
  progressData: [
    { id: 1, book: '개념유형 파워 3-1', range: '3단원 나눗셈 ~ 4단원 곱셈', rate: 85, color: 'bg-blue-500', bg: 'bg-blue-50', text: 'text-blue-600' },
    { id: 2, book: '1031 입문 A', range: '1. 수와 숫자 ~ 2. 연산', rate: 40, color: 'bg-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-600' }
  ],
  testData: [
    { id: 1, title: '3월 월말평가 (3-1 과정)', date: '03.28', score: 95, avg: 82, type: '월말평가' },
    { id: 2, title: '주간 연산 테스트', date: '03.14', score: 100, avg: 88, type: '주간평가' }
  ],
  calendarData: {
    "3": ["attendance", "homework"],
    "5": ["attendance", "homework"],
    "10": ["attendance", "homework"],
    "12": ["absent"],
    "17": ["attendance", "homework"],
    "19": ["attendance", "issue"],
    "24": ["attendance", "homework"],
    "26": ["attendance", "homework"],
    "31": ["attendance", "homework"]
  } as Record<string, string[]>,
  calendarNotes: [
    { date: '03.19', type: '특이사항', desc: '문제집 미지참, 숙제 일부 미완료 (보충 완료)', color: 'text-red-500', bg: 'bg-red-50' },
    { date: '03.24', type: '마감', desc: '1031 입문 A 1단원 오답노트 제출 완료', color: 'text-blue-500', bg: 'bg-blue-50' },
  ],
  teacherComment: "안녕하세요, 학부모님😊\n이번 3월 한 달 동안 재이가 새로운 학기에 적응하느라 고생이 많았을 텐데, 학원 수업에도 빠짐없이 성실하게 참여해주어 무척 대견합니다.\n\n특히 개념편 숙제를 아주 훌륭하게 마무리했고, 오답 노트도 꼼꼼히 작성하는 습관이 잘 잡혀가고 있습니다. 다가오는 4월에는 심화 문제 풀이에 조금 더 집중할 계획입니다. 가정에서도 많은 칭찬과 격려 부탁드립니다!",
  teacherName: "김수학",
  report1Images: ["https://picsum.photos/seed/report1/800/1131"],
  report2Images: ["https://picsum.photos/seed/report2/800/1131"]
};

export default function App() {
  const [data, setData] = useState(defaultData);
  const [isEditing, setIsEditing] = useState(false);
  const [jsonInput, setJsonInput] = useState(JSON.stringify(defaultData, null, 2));
  const reportRef = useRef<HTMLDivElement>(null);

  const handleExportImage = async () => {
    if (!reportRef.current) return;
    try {
      // html2canvas 렌더링 전 약간의 지연을 주어 폰트/이미지 로딩 대기
      await new Promise(resolve => setTimeout(resolve, 100));
      const canvas = await html2canvas(reportRef.current, {
        scale: 2, // 고해상도
        useCORS: true,
        backgroundColor: '#f9fafb', // bg-gray-50
        windowWidth: reportRef.current.scrollWidth,
        windowHeight: reportRef.current.scrollHeight
      });
      const image = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = image;
      link.download = `${data.studentName}_${data.month}_학습리포트.png`;
      link.click();
    } catch (error) {
      console.error('Failed to export image', error);
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
        setIsEditing(false);
      } catch (err) {
        alert('올바른 JSON 파일이 아닙니다.');
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  const handleApplyJson = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      setData(parsed);
      setIsEditing(false);
    } catch (err) {
      alert('JSON 형식이 올바르지 않습니다. 쉼표나 괄호를 확인해주세요.');
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, key: 'report1Images' | 'report2Images') => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    Promise.all(files.map(file => {
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target?.result as string);
        reader.readAsDataURL(file);
      });
    })).then(images => {
      setData(prev => ({ ...prev, [key]: images }));
    });
  };

  // 캘린더 렌더링 헬퍼 (주말 제외, 평일 5일 기준)
  const renderCalendarDays = () => {
    const days = [];
    const monthNum = parseInt(data.month) || 3;
    const year = 2026;
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    const firstDay = new Date(year, monthNum - 1, 1).getDay();
    
    // 첫 날이 주말이면 빈 칸 없음, 평일이면 해당 요일만큼 빈 칸 추가 (월=1 이므로 -1)
    const emptyCells = (firstDay === 0 || firstDay === 6) ? 0 : firstDay - 1;
    
    for (let i = 0; i < emptyCells; i++) {
      days.push(<div key={`empty-${i}`} className="min-h-[130px] bg-transparent"></div>);
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(year, monthNum - 1, i);
      const dayOfWeek = date.getDay();
      
      // 주말(토, 일) 제외
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      const dayData = data.calendarData[i.toString()] || [];
      const hasAttendance = dayData.includes('attendance');
      const hasHomework = dayData.includes('homework');
      const isAbsent = dayData.includes('absent');
      const hasIssue = dayData.includes('issue');

      const dateString = `${String(monthNum).padStart(2, '0')}.${i.toString().padStart(2, '0')}`;
      const dayNotes = data.calendarNotes.filter(n => n.date === dateString);

      days.push(
        <div key={i} className="min-h-[130px] flex flex-col items-start justify-start p-2 border border-gray-200 bg-white rounded-xl shadow-sm overflow-hidden">
          <span className="text-sm font-bold mb-1 text-gray-700 w-full text-center">
            {i}
          </span>
          <div className="flex flex-wrap gap-1 w-full mb-1 justify-center">
            {hasAttendance && <div className="text-[10px] bg-green-100 text-green-700 rounded px-1 py-0.5 font-bold">출석</div>}
            {isAbsent && <div className="text-[10px] bg-gray-100 text-gray-600 rounded px-1 py-0.5 font-bold">결석</div>}
            {hasHomework && <div className="text-[10px] bg-blue-100 text-blue-700 rounded px-1 py-0.5 font-bold">숙제</div>}
            {hasIssue && <div className="text-[10px] bg-red-100 text-red-700 rounded px-1 py-0.5 font-bold">특이사항</div>}
          </div>
          {dayNotes.length > 0 && (
            <div className="w-full mt-1 flex flex-col gap-1">
              {dayNotes.map((note, idx) => (
                <div key={idx} className={`text-[10px] leading-snug p-1.5 rounded-md ${note.bg} ${note.color} font-medium break-keep`}>
                  {note.desc}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    return days;
  };

  return (
    <div className="min-h-screen bg-gray-200 flex flex-col items-center font-sans py-8 px-4">
      
      {/* Control Panel (Not included in image export) */}
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm p-4 mb-6 flex flex-col gap-4 z-50">
        <div className="flex justify-between items-center">
          <div className="flex gap-2">
            <label className="cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors">
              <Upload className="w-4 h-4" /> 데이터 올리기
              <input type="file" accept=".json" className="hidden" onChange={handleFileUpload} />
            </label>
            <button onClick={() => setIsEditing(true)} className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors">
              <Settings className="w-4 h-4" /> 직접 수정
            </button>
          </div>
          <button onClick={handleExportImage} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm transition-colors">
            <Download className="w-4 h-4" /> 이미지 저장
          </button>
        </div>
        <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
          <p className="text-xs text-blue-800 font-medium mb-2">💡 데이터 업로드 예시 (JSON 복사해서 사용하세요)</p>
          <pre className="text-[10px] text-blue-900 bg-white p-2 rounded border border-blue-200 overflow-x-auto max-h-32">
{`{
  "studentName": "학생이름",
  "month": "4월",
  "progressData": [
    { "id": 1, "book": "교재명", "range": "진도 범위", "rate": 80, "color": "bg-blue-500", "bg": "bg-blue-50", "text": "text-blue-600" }
  ],
  "testData": [
    { "id": 1, "title": "테스트명", "date": "04.15", "score": 90, "avg": 85, "type": "평가종류" }
  ],
  "calendarData": {
    "1": ["attendance", "homework"],
    "15": ["absent", "issue"]
  },
  "calendarNotes": [
    { "date": "04.15", "type": "특이사항", "desc": "결석 사유", "color": "text-red-500", "bg": "bg-red-50" }
  ],
  "teacherComment": "선생님 코멘트 내용...",
  "teacherName": "선생님 이름"
}`}
          </pre>
        </div>
      </div>

      {/* JSON Edit Modal */}
      {isEditing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <Settings className="w-5 h-5 text-gray-500" /> 데이터 직접 수정 (JSON)
              </h2>
              <button onClick={() => setIsEditing(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 p-5 overflow-hidden flex flex-col">
              <p className="text-xs text-gray-500 mb-3">
                아래 JSON 데이터를 수정하여 리포트 내용을 변경할 수 있습니다. 
                <br/>(주의: 쉼표나 괄호 등 JSON 형식을 정확히 지켜주세요.)
              </p>
              <textarea 
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="w-full flex-1 p-4 bg-gray-50 border border-gray-200 rounded-xl font-mono text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                spellCheck={false}
              />
            </div>
            <div className="p-5 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button 
                onClick={() => setIsEditing(false)}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200 transition-colors"
              >
                취소
              </button>
              <button 
                onClick={handleApplyJson}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors"
              >
                적용하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report Container (Target for html2canvas) */}
      <div className="w-full overflow-x-auto pb-24 flex justify-center">
        <div ref={reportRef} className="w-[794px] min-h-[1123px] bg-white shadow-2xl relative pb-12 overflow-hidden shrink-0">
          
          {/* Header */}
          <header className="bg-white px-10 pt-16 pb-8 border-b border-gray-100 relative z-10">
            <div className="flex justify-between items-start mb-8">
              <div>
                <p className="text-lg font-bold text-blue-600 mb-2">월간 학습 리포트</p>
                <h1 className="text-4xl font-bold text-gray-800 tracking-tight leading-snug">
                  <span className="text-blue-600">{data.studentName}</span> 학생의<br/>{data.month} 리포트입니다
                </h1>
              </div>
              <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 shadow-inner">
                <User className="w-8 h-8" />
              </div>
            </div>
            <div className="flex gap-3">
              <div className="bg-gray-100 px-4 py-2 rounded-xl text-base font-medium text-gray-600 flex items-center gap-2">
                <CalendarIcon className="w-5 h-5" /> {data.month}
              </div>
              <div className="bg-blue-50 px-4 py-2 rounded-xl text-base font-medium text-blue-600 flex items-center gap-2">
                <BookOpen className="w-5 h-5" /> 초등수학
              </div>
            </div>
          </header>

          <main className="px-10 py-8 space-y-10">
            
            {/* 1. 수업 진도 기록 */}
            <section>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">1</div>
                <h2 className="text-2xl font-bold text-gray-800">수업 진도 기록</h2>
              </div>
              <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200 space-y-6">
                {data.progressData.map((item) => (
                  <div key={item.id}>
                    <div className="flex justify-between items-end mb-3">
                      <div>
                        <h3 className="font-bold text-gray-800 text-xl">{item.book}</h3>
                        <p className="text-sm text-gray-500 mt-1">{item.range}</p>
                      </div>
                      <span className={`${item.text} font-bold text-lg ${item.bg} px-4 py-1.5 rounded-xl`}>{item.rate}%</span>
                    </div>
                    <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full ${item.color} rounded-full transition-all duration-1000 ease-out`} style={{ width: `${item.rate}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 2. 이달의 수학 TEST */}
            <section>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">2</div>
                <h2 className="text-2xl font-bold text-gray-800">이달의 수학 TEST</h2>
              </div>
              <div className="grid grid-cols-2 gap-5">
                {data.testData.map((test) => (
                  <div key={test.id} className="bg-white rounded-3xl p-6 shadow-sm border border-gray-200 flex flex-col justify-between">
                    <div className="mb-4">
                      <span className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-lg mb-3 inline-block">{test.date}</span>
                      <h3 className="font-bold text-gray-800 text-lg mb-1">{test.title}</h3>
                      <p className="text-sm text-gray-500">반 평균: {test.avg}점</p>
                    </div>
                    <div className="text-right mt-auto">
                      <div className="text-4xl font-black text-blue-600">{test.score}<span className="text-lg text-gray-400 font-medium">점</span></div>
                      <span className="text-xs text-emerald-600 font-bold bg-emerald-100 px-3 py-1 rounded-md mt-2 inline-block">통과</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 3. 수학 학습 관리 (캘린더형) */}
            <section>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">3</div>
                <h2 className="text-2xl font-bold text-gray-800">수학 학습 관리</h2>
              </div>
              <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-200">
                {/* 범례 */}
                <div className="flex flex-wrap gap-4 mb-6 text-sm font-medium text-gray-600 bg-gray-50 p-4 rounded-2xl">
                  <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-green-500 shadow-sm"></div>출석</div>
                  <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500 shadow-sm"></div>숙제 제출</div>
                  <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500 shadow-sm"></div>미제출/특이사항</div>
                </div>

                {/* 달력 그리드 */}
                <div className="mb-8">
                  <div className="grid grid-cols-5 gap-2 text-center mb-3">
                    {['월', '화', '수', '목', '금'].map((d) => (
                      <div key={d} className="text-sm font-bold py-2 text-gray-500">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {renderCalendarDays()}
                  </div>
                </div>

                {/* 특이사항 기록 */}
                <div className="border-t border-gray-100 pt-6">
                  <h4 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-gray-400" /> 주요 기록 및 특이사항
                  </h4>
                  <div className="space-y-4">
                    {data.calendarNotes.map((note, idx) => (
                      <div key={idx} className="flex items-start gap-4 text-base">
                        <span className="text-sm font-bold text-gray-400 mt-1 w-12 shrink-0">{note.date}</span>
                        <div className={`${note.bg} ${note.color} px-3 py-1 rounded-md text-xs font-bold shrink-0 mt-0.5`}>{note.type}</div>
                        <p className="text-gray-700 text-sm leading-relaxed">{note.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* 4. 경시대회 리포트 */}
            <section>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">4</div>
                  <h2 className="text-2xl font-bold text-gray-800">경시대회 리포트</h2>
                </div>
                <label className="cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shadow-sm">
                  <Upload className="w-4 h-4"/> 이미지 업로드 (다중 선택)
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleImageUpload(e, 'report1Images')} />
                </label>
              </div>
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-200">
                <div className={`grid gap-4 ${data.report1Images.length > 1 ? 'grid-cols-2' : 'grid-cols-1 max-w-md mx-auto'}`}>
                  {data.report1Images.map((img, idx) => (
                    <div key={idx} className="rounded-2xl overflow-hidden relative bg-gray-100 aspect-[1/1.414]">
                      <img 
                        src={img} 
                        alt={`경시대회 리포트 ${idx + 1}`} 
                        className="w-full h-full object-cover opacity-90 mix-blend-multiply"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* 5. 진단평가 리포트 */}
            <section>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">5</div>
                  <h2 className="text-2xl font-bold text-gray-800">진단평가 리포트</h2>
                </div>
                <label className="cursor-pointer bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors shadow-sm">
                  <Upload className="w-4 h-4"/> 이미지 업로드 (다중 선택)
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleImageUpload(e, 'report2Images')} />
                </label>
              </div>
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-200">
                <div className={`grid gap-4 ${data.report2Images.length > 1 ? 'grid-cols-2' : 'grid-cols-1 max-w-md mx-auto'}`}>
                  {data.report2Images.map((img, idx) => (
                    <div key={idx} className="rounded-2xl overflow-hidden relative bg-gray-100 aspect-[1/1.414]">
                      <img 
                        src={img} 
                        alt={`진단평가 리포트 ${idx + 1}`} 
                        className="w-full h-full object-cover opacity-90 mix-blend-multiply"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* 6. 학부모님께 */}
            <section>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 font-bold text-lg">6</div>
                <h2 className="text-2xl font-bold text-gray-800">학부모님께</h2>
              </div>
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-3xl p-8 border border-amber-200/50 shadow-sm relative overflow-hidden">
                <div className="absolute -right-6 -bottom-6 text-amber-200/40">
                  <MessageCircle className="w-48 h-48" />
                </div>
                <div className="relative z-10">
                  <p className="text-amber-900 text-base leading-loose bg-white/70 p-6 rounded-2xl backdrop-blur-sm shadow-sm whitespace-pre-wrap">
                    {data.teacherComment}
                  </p>
                  <div className="mt-6 flex items-center gap-4 justify-end">
                    <div className="text-right">
                      <p className="text-sm text-amber-700/70 font-medium">담임 강사</p>
                      <p className="text-lg font-bold text-amber-900">{data.teacherName} 선생님</p>
                    </div>
                    <div className="w-14 h-14 bg-amber-200 rounded-full flex items-center justify-center text-amber-700 shadow-sm text-xl">
                      <span className="font-bold">{data.teacherName[0]}</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

          </main>
        </div>
      </div>
    </div>
  );
}
