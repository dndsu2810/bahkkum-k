/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState, useRef } from 'react';
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  BarElement, 
  Title, 
  Tooltip, 
  Legend,
  ArcElement
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { 
  User, 
  Calendar, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  FileText, 
  TrendingUp, 
  GraduationCap,
  Printer,
  Download,
  Eye,
  Upload,
  X,
  Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import html2canvas from 'html2canvas';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

// Types
interface WeeklyEvaluation {
  week: number;
  unit: string;
  score: number;
  incorrectQuestions: number[];
  examUrl?: string;
}

interface AttendanceData {
  totalDays: number;
  attended: number;
  late: number;
  absent: number;
}

export default function App() {
  const reportRef = useRef<HTMLDivElement>(null);
  
  // Sample Data
  const studentName = "김철수";
  const reportTitle = "3월 수학 종합 리포트";
  
  const [weeklyData, setWeeklyData] = useState<WeeklyEvaluation[]>([
    { week: 1, unit: "수의 범위와 어림하기", score: 92, incorrectQuestions: [5, 12], examUrl: 'https://picsum.photos/seed/exam1/800/1200' },
    { week: 2, unit: "도형의 합동과 대칭", score: 78, incorrectQuestions: [4, 7, 15, 18] },
    { week: 3, unit: "분수의 곱셈", score: 88, incorrectQuestions: [9, 20] },
    { week: 4, unit: "도형의 넓이", score: 72, incorrectQuestions: [2, 5, 8, 11, 14] },
  ]);

  const [selectedExam, setSelectedExam] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const attendance: AttendanceData = {
    totalDays: 20,
    attended: 18,
    late: 1,
    absent: 1,
  };

  const lastMonthAvg = 79;
  const thisMonthAvg = Math.round(weeklyData.reduce((acc, curr) => acc + curr.score, 0) / weeklyData.length);

  // Automatic Weakness Analysis Logic
  const weaknessAnalysis = useMemo(() => {
    const weaknesses = weeklyData
      .filter(d => d.score < 85)
      .map(d => `${d.week}주차 ${d.unit} 파트에서 ${d.incorrectQuestions.length}문항(${d.incorrectQuestions.join(', ')}번)을 틀린 것으로 보아 해당 단원의 개념 이해 및 응용력이 부족합니다.`);
    
    if (weaknesses.length === 0) {
      return "전반적으로 모든 단원에서 우수한 성적을 거두었습니다. 현재의 학습 페이스를 유지하며 심화 문제 풀이에 집중해 보세요.";
    }

    const geometryIssues = weeklyData.filter(d => d.unit.includes("도형") && d.score < 80);
    let extraComment = "";
    if (geometryIssues.length > 0) {
      extraComment = " 특히 도형 관련 단원에서 반복적인 오답이 발생하는 것으로 보아 공간 지각력 및 기하학적 원리 보완이 시급합니다.";
    }

    return weaknesses.join(' ') + extraComment;
  }, [weeklyData]);

  // Chart Data
  const chartData = {
    labels: ['지난 달 평균', '이번 달 평균'],
    datasets: [
      {
        label: '평균 점수',
        data: [lastMonthAvg, thisMonthAvg],
        backgroundColor: [
          'rgba(203, 213, 225, 0.8)', // Slate 300 (Neutral)
          'rgba(51, 65, 85, 0.8)',   // Slate 700 (Neutral)
        ],
        borderRadius: 8,
        barThickness: 60,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context: any) => ` 점수: ${context.raw}점`,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: 100,
        grid: {
          display: false,
        },
      },
      x: {
        grid: {
          display: false,
        },
      },
    },
  };

  const handleExportImage = async () => {
    if (!reportRef.current) return;
    setIsExporting(true);
    try {
      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#f8fafc',
        logging: false,
      });
      const image = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = image;
      link.download = `${studentName}_${reportTitle}.png`;
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileUpload = (week: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setWeeklyData(prev => prev.map(d => d.week === week ? { ...d, examUrl: url } : d));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Action Buttons */}
        <div className="flex justify-end gap-3 no-print">
          <button 
            onClick={handleExportImage}
            disabled={isExporting}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium shadow-sm disabled:opacity-50"
          >
            <Download size={16} />
            {isExporting ? '이미지 생성 중...' : '이미지로 저장'}
          </button>
          <button 
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm"
          >
            <Printer size={16} />
            리포트 출력하기
          </button>
        </div>

        {/* Main Report Content */}
        <div ref={reportRef} className="space-y-6 p-1">
          {/* Header Section */}
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-2xl shadow-sm border border-blue-100 gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center border-2 border-blue-100 shadow-sm overflow-hidden">
                    {/* Whale Icon Placeholder - In a real app, replace src with the actual logo URL */}
                    <img 
                      src="https://api.dicebear.com/7.x/shapes/svg?seed=whale&backgroundColor=b6e3f4" 
                      alt="Logo" 
                      className="w-12 h-12 object-contain"
                    />
                  </div>
                  <div className="absolute -bottom-1 -right-1 bg-blue-500 text-white p-1 rounded-full border-2 border-white">
                    <GraduationCap size={10} />
                  </div>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-blue-400 leading-none">바라던 꿈을 이루다</span>
                  <span className="text-xl font-black text-blue-500 tracking-tighter leading-tight">바꿈영수학원</span>
                </div>
              </div>
              <div className="h-10 w-[1px] bg-slate-200 mx-2 hidden md:block"></div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{reportTitle}</h1>
                <div className="flex items-center gap-2 text-slate-500 text-sm mt-1">
                  <User size={14} />
                  <span className="font-semibold text-slate-700">{studentName} 학생</span>
                  <span className="mx-1">|</span>
                  <Calendar size={14} />
                  <span>2024년 3월호</span>
                </div>
              </div>
            </div>
            <div className="hidden md:block text-right">
              <p className="text-xs text-slate-400">바라던 꿈을 이루다</p>
              <p className="text-lg font-black text-blue-500 tracking-tighter">바꿈영수학원</p>
            </div>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Score Trend Card */}
            <section className="lg:col-span-1 bg-white p-6 rounded-2xl shadow-sm border border-blue-100 flex flex-col">
              <div className="flex items-center gap-2 mb-6">
                <TrendingUp className="text-slate-700" size={20} />
                <h2 className="text-lg font-bold text-slate-800">성적 변화 추이</h2>
              </div>
              <div className="flex-grow min-h-[250px] relative">
                <Bar data={chartData} options={chartOptions} />
              </div>
              <div className="mt-4 p-4 bg-slate-50 rounded-xl">
                <p className="text-sm text-slate-600 text-center">
                  지난 달 대비 <span className="font-bold text-slate-900">{thisMonthAvg - lastMonthAvg > 0 ? `+${thisMonthAvg - lastMonthAvg}` : thisMonthAvg - lastMonthAvg}점</span> 변화하였습니다.
                </p>
              </div>
            </section>

            {/* Weekly Evaluation Table Card */}
            <section className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-blue-100">
              <div className="flex items-center gap-2 mb-6">
                <FileText className="text-slate-700" size={20} />
                <h2 className="text-lg font-bold text-slate-800">주간 평가 상세 기록</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="bg-slate-50 border-y border-slate-100">
                      <th className="px-4 py-3 font-semibold text-slate-600">주차</th>
                      <th className="px-4 py-3 font-semibold text-slate-600">평가 단원명</th>
                      <th className="px-4 py-3 font-semibold text-slate-600">점수</th>
                      <th className="px-4 py-3 font-semibold text-slate-600">틀린 문항</th>
                      <th className="px-4 py-3 font-semibold text-slate-600 no-print">시험지</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {weeklyData.map((data) => (
                      <tr key={data.week} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-4 font-medium text-slate-900">{data.week}주차</td>
                        <td className="px-4 py-4 text-slate-700">{data.unit}</td>
                        <td className="px-4 py-4">
                          <span className="font-bold text-slate-900">
                            {data.score}점
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-1">
                            {data.incorrectQuestions.map(q => (
                              <span key={q} className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-xs">
                                {q}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-4 no-print">
                          <div className="flex items-center gap-2">
                            {data.examUrl ? (
                              <button 
                                onClick={() => setSelectedExam(data.examUrl!)}
                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="시험지 보기"
                              >
                                <Eye size={18} />
                              </button>
                            ) : (
                              <label className="p-2 text-slate-400 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer" title="시험지 등록">
                                <Upload size={18} />
                                <input 
                                  type="file" 
                                  className="hidden" 
                                  accept="image/*"
                                  onChange={(e) => handleFileUpload(data.week, e)}
                                />
                              </label>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Weakness Analysis Card */}
            <section className="lg:col-span-3 bg-slate-800 p-8 rounded-2xl shadow-lg text-white relative overflow-hidden">
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-4">
                  <AlertCircle size={24} className="text-blue-400" />
                  <h2 className="text-xl font-bold">취약점 자동 분석 결과</h2>
                </div>
                <div className="bg-white/5 backdrop-blur-md p-6 rounded-xl border border-white/10 leading-relaxed text-slate-200">
                  {weaknessAnalysis}
                </div>
              </div>
              <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl"></div>
            </section>

            {/* Attendance Status Card */}
            <section className="lg:col-span-1 bg-white p-6 rounded-2xl shadow-sm border border-blue-100">
              <div className="flex items-center gap-2 mb-6">
                <Clock className="text-slate-700" size={20} />
                <h2 className="text-lg font-bold text-slate-800">출결 현황</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-xl text-center">
                  <p className="text-xs text-slate-500 mb-1">총 수업일</p>
                  <p className="text-xl font-bold text-slate-800">{attendance.totalDays}일</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl text-center">
                  <p className="text-xs text-slate-500 mb-1">출석</p>
                  <p className="text-xl font-bold text-slate-800">{attendance.attended}일</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl text-center">
                  <p className="text-xs text-slate-500 mb-1">지각</p>
                  <p className="text-xl font-bold text-slate-800">{attendance.late}회</p>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl text-center">
                  <p className="text-xs text-slate-500 mb-1">결석</p>
                  <p className="text-xl font-bold text-slate-800">{attendance.absent}회</p>
                </div>
              </div>
              <div className="mt-6 flex items-center justify-between text-sm px-2">
                <span className="text-slate-500">출석률</span>
                <span className="font-bold text-slate-900">{(attendance.attended / attendance.totalDays * 100).toFixed(0)}%</span>
              </div>
              <div className="mt-2 w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-slate-700 h-full transition-all duration-1000" 
                  style={{ width: `${(attendance.attended / attendance.totalDays * 100)}%` }}
                ></div>
              </div>
            </section>

            {/* Teacher Comment Card */}
            <section className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-blue-100">
              <div className="flex items-center gap-2 mb-6">
                <CheckCircle2 className="text-slate-700" size={20} />
                <h2 className="text-lg font-bold text-slate-800">선생님 코멘트</h2>
              </div>
              <div className="relative">
                <textarea 
                  className="w-full h-40 p-4 bg-slate-50 rounded-xl border border-slate-100 focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none transition-all resize-none text-slate-700 leading-relaxed"
                  placeholder="학생에 대한 종합적인 피드백을 입력해 주세요..."
                  defaultValue={`${studentName} 학생은 이번 달 수의 범위와 어림하기 단원에서 매우 우수한 성취도를 보였습니다. 다만, 도형 단원에서 복합적인 응용 문제를 풀 때 다소 어려움을 겪는 모습이 관찰되었습니다. 다음 달에는 기하 영역의 기본 원리를 다시 한번 점검하고, 오답 노트를 활용하여 취약 유형을 집중적으로 보완할 예정입니다. 전반적인 학습 태도는 매우 성실하며 질문이 많아 발전 가능성이 큽니다.`}
                />
                <div className="absolute bottom-4 right-4 text-xs text-slate-400">
                  담당 선생님: 이지혜
                </div>
              </div>
            </section>

          </div>

          {/* Footer */}
          <footer className="text-center py-8 text-slate-400 text-xs">
            <div className="flex items-center justify-center gap-2 mb-2">
              <div className="w-6 h-6 bg-blue-500 rounded flex items-center justify-center text-white">
                <GraduationCap size={14} />
              </div>
              <span className="font-bold text-slate-600">바꿈영수학원</span>
            </div>
            <p>© 2024 바꿈영수학원. All rights reserved.</p>
            <p className="mt-1">본 리포트는 학생의 학습 향상을 위한 참고 자료로만 활용해 주시기 바랍니다.</p>
          </footer>
        </div>

      </div>

      {/* Exam Viewer Modal */}
      <AnimatePresence>
        {selectedExam && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm no-print"
            onClick={() => setSelectedExam(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-4xl w-full bg-white rounded-2xl overflow-hidden shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <ImageIcon size={18} className="text-blue-500" />
                  주간 평가 시험지 확인
                </h3>
                <button 
                  onClick={() => setSelectedExam(null)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-4 overflow-y-auto max-h-[80vh] flex justify-center bg-slate-100">
                <img 
                  src={selectedExam} 
                  alt="Exam Paper" 
                  className="max-w-full h-auto shadow-lg rounded"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="p-4 bg-slate-50 text-center text-xs text-slate-500">
                마우스 휠을 사용하여 확대/축소할 수 있습니다.
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background-color: white !important;
            padding: 0 !important;
          }
          .shadow-sm, .shadow-lg, .shadow-2xl {
            box-shadow: none !important;
          }
          .border {
            border: 1px solid #e2e8f0 !important;
          }
          .bg-slate-50 {
            background-color: #f8fafc !important;
          }
          .bg-slate-800 {
            background-color: #1e293b !important;
            color: white !important;
            -webkit-print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
}
