import { useRef, useState } from 'react';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import { Download, Calendar, ChevronDown, GraduationCap, Image, Award, Printer, Smartphone } from 'lucide-react';
import { domToPng } from 'modern-screenshot';
import type { Student } from '../types';

interface ReportCardProps {
  student: Student;
}

export function ReportCard({ student }: ReportCardProps) {
  const reportRef = useRef<HTMLDivElement>(null);
  const page1Ref = useRef<HTMLDivElement>(null);
  const page2Ref = useRef<HTMLDivElement>(null);
  const [showPrintGuide, setShowPrintGuide] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Convert scores to numeric values for radar chart
  const scoreToValue = (score: string): number => {
    const scoreMap: { [key: string]: number } = {
      'P': 6,
      'E': 5,
      'GR': 4,
      'G': 3,
      'VG': 2,
      'NI': 1
    };
    return scoreMap[score] || 0;
  };

  const radarData = [
    { subject: 'Listening', value: scoreToValue(student.evaluations[0].score), fullMark: 6 },
    { subject: 'Reading', value: scoreToValue(student.evaluations[1].score), fullMark: 6 },
    { subject: 'Speaking', value: scoreToValue(student.evaluations[2].score), fullMark: 6 },
    { subject: 'Spelling & Writing', value: scoreToValue(student.evaluations[3].score), fullMark: 6 },
    { subject: 'Comprehension', value: scoreToValue(student.evaluations[4].score), fullMark: 6 },
    { subject: 'Attitude', value: scoreToValue(student.evaluations[5].score), fullMark: 6 },
    { subject: 'Performance', value: scoreToValue(student.evaluations[6].score), fullMark: 6 },
    { subject: 'Confidence', value: scoreToValue(student.evaluations[7].score), fullMark: 6 }
  ];

  // PDF/이미지 저장 - 브라우저 인쇄 기능 활용
  const handlePrint = () => {
    window.print();
  };

  // 이미지 캡처 기능
  const handleCaptureImage = async () => {
    if (!reportRef.current) return;

    try {
      const dataUrl = await domToPng(reportRef.current, {
        scale: 3,
        backgroundColor: '#ffffff',
      });

      // 데이터 URL을 다운로드
      const link = document.createElement('a');
      const fileName = `성적표_${student.studentName}_${formatEvaluationMonth(student.evaluationMonth)}.png`;
      link.href = dataUrl;
      link.download = fileName;
      link.click();
    } catch (error) {
      console.error('Image capture failed:', error);
      alert('이미지 캡처에 실패했습니다.');
    }
  };

  // 핸드폰 전송용 분할 저장 - 세로 레이아웃을 2장으로 나눠 저장
  const handleSplitCapture = async () => {
    const pages = [page1Ref.current, page2Ref.current].filter(Boolean) as HTMLElement[];
    if (pages.length === 0) return;

    setIsSaving(true);
    try {
      const monthLabel = formatEvaluationMonth(student.evaluationMonth);
      for (let i = 0; i < pages.length; i++) {
        const dataUrl = await domToPng(pages[i], {
          scale: 2,
          backgroundColor: '#ffffff',
        });
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `성적표_${student.studentName}_${monthLabel}_${i + 1}.png`;
        link.click();
        // 브라우저가 연속 다운로드를 막지 않도록 약간의 간격
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error('Split capture failed:', error);
      alert('분할 저장에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  // 인쇄 가이드 표시
  const handleShowGuide = () => {
    setShowPrintGuide(true);
  };

  // Format evaluation month for display
  const formatEvaluationMonth = (dateString: string): string => {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    return `${year}년 ${month}월`;
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Action Bar */}
      <div className="mb-6 flex justify-end items-center gap-3">
        <button
          type="button"
          onClick={handlePrint}
          className="flex items-center gap-2 bg-gradient-to-r from-[#2196F3] to-[#1976D2] hover:from-[#1E88E5] hover:to-[#1565C0] text-white px-6 py-3 rounded-xl shadow-lg transition-all hover:shadow-xl"
        >
          <Download className="w-5 h-5" />
          PDF 저장하기
        </button>
        <button
          type="button"
          onClick={handleCaptureImage}
          className="flex items-center gap-2 bg-gradient-to-r from-[#4CAF50] to-[#45A049] hover:from-[#45A049] hover:to-[#4CAF50] text-white px-6 py-3 rounded-xl shadow-lg transition-all hover:shadow-xl"
        >
          <Image className="w-5 h-5" />
          이미지 저장하기
        </button>
        <button
          type="button"
          onClick={handleSplitCapture}
          disabled={isSaving}
          className="flex items-center gap-2 bg-gradient-to-r from-[#FF9800] to-[#F57C00] hover:from-[#FB8C00] hover:to-[#EF6C00] text-white px-6 py-3 rounded-xl shadow-lg transition-all hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed"
          title="핸드폰 전송용으로 글씨를 키워 2장으로 나눠 저장합니다"
        >
          <Smartphone className="w-5 h-5" />
          {isSaving ? '저장 중...' : '분할 저장 (폰 전송용)'}
        </button>
        <button
          type="button"
          onClick={handleShowGuide}
          className="text-gray-400 hover:text-[#1976D2] transition-colors"
          title="저장 방법 도움말"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>

      <div id="export-area" ref={reportRef} className="bg-white shadow-2xl rounded-3xl overflow-hidden border-2 border-gray-100 print:rounded-lg print:shadow-none print:border-0">
        {/* Premium Header with Branding */}
        <div className="bg-gradient-to-r from-[#1976D2] via-[#2196F3] to-[#42A5F5] text-white px-8 py-4 print:px-3 print:py-1 relative overflow-hidden">
          {/* Decorative Elements */}
          <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -mr-48 -mt-48 print:hidden"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full -ml-32 -mb-32 print:hidden"></div>
          
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-4 print:gap-1.5">
              {/* Premium Logo */}
              <div className="w-16 h-16 print:w-7 print:h-7 bg-white/15 backdrop-blur-md rounded-2xl print:rounded-lg flex items-center justify-center border-2 border-white/30 shadow-xl">
                <GraduationCap className="w-10 h-10 print:w-4 print:h-4 text-white drop-shadow-lg" />
              </div>
              <div>
                <h1 className="text-3xl print:text-base mb-1 print:mb-0 tracking-tight">바꿈영수학원</h1>
                <p className="text-sm print:text-[8px] opacity-95 tracking-wide">Bakkum English & Math Academy</p>
                <div className="flex items-center gap-2 mt-1 print:hidden">
                  <Award className="w-4 h-4 opacity-90" />
                  <span className="text-sm opacity-90">Premium Education Excellence</span>
                </div>
              </div>
            </div>
            <div className="text-right bg-white/10 backdrop-blur-sm rounded-2xl print:rounded-lg px-5 py-3 print:px-2 print:py-0.5 border border-white/20">
              <div className="text-xs print:text-[7px] opacity-95 mb-1 print:mb-0 tracking-wide">Student Progress Report</div>
              <div className="text-2xl print:text-xs tracking-tight">성적표</div>
            </div>
          </div>
        </div>

        {/* Compact Student Info Section */}
        <div className="bg-gradient-to-br from-[#E3F2FD] to-[#BBDEFB] px-6 py-3 print:px-2 print:py-1 border-b border-[#2196F3]">
          <div className="flex items-center justify-between gap-4 print:gap-2 text-base print:text-[10px]">
            <div className="flex items-center gap-1">
              <span className="text-[#1565C0] opacity-80">학생:</span>
              <span className="text-gray-900 print:font-semibold">{student.studentName}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[#1565C0] opacity-80">선생님:</span>
              <span className="text-gray-900">{student.teacherName}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[#1565C0] opacity-80">평가월:</span>
              <span className="text-gray-900">{formatEvaluationMonth(student.evaluationMonth)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[#1565C0] opacity-80">학년:</span>
              <span className="text-gray-900">Grade {student.grade}</span>
            </div>
          </div>
        </div>

        {/* Main Content Area - Premium Split View */}
        <div className="grid grid-cols-1 lg:grid-cols-2 print:grid-cols-2">
          {/* Left Panel - Evaluation Table */}
          <div className="border-r-2 border-gray-200">
            {/* Section Header */}
            <div className="bg-gradient-to-r from-[#BBDEFB] to-[#90CAF9] px-4 py-3 print:px-2 print:py-1.5 border-b-2 border-[#2196F3]">
              <h3 className="text-center text-gray-800 text-base print:text-[10px] tracking-wide">Categorized Evaluation: Overall Academics</h3>
            </div>

            {/* Table Header */}
            <div className="grid grid-cols-[3fr_1fr_2fr] bg-gradient-to-r from-[#E3F2FD] to-[#BBDEFB] border-b-2 border-[#90CAF9]">
              <div className="px-4 py-3 print:px-2 print:py-1 text-sm print:text-[9px] text-[#1565C0] uppercase tracking-wider">Criteria</div>
              <div className="px-3 py-3 print:px-1 print:py-1 text-center text-sm print:text-[9px] text-[#1565C0] uppercase tracking-wider border-l-2 border-white">Score</div>
              <div className="px-3 py-3 print:px-1 print:py-1 text-center text-sm print:text-[9px] text-[#1565C0] uppercase tracking-wider border-l-2 border-white">Grade</div>
            </div>

            {/* Evaluation Rows */}
            <div className="divide-y-2 divide-gray-100">
              {student.evaluations.map((item, index) => (
                <div key={index} className="grid grid-cols-[3fr_1fr_2fr] hover:bg-blue-50/70 transition-colors group">
                  <div className="px-4 py-3 print:px-2 print:py-1">
                    <div className="text-gray-900 text-base print:text-[10px]">{item.criteria}</div>
                    <div className="text-sm print:text-[8px] text-gray-500 mt-0.5 print:mt-0">{item.criteriaKo}</div>
                  </div>
                  <div className="px-3 py-3 print:px-1 print:py-1 text-center border-l-2 border-gray-100 flex items-center justify-center">
                    <span className="inline-flex items-center justify-center w-12 h-12 print:w-7 print:h-7 bg-gradient-to-br from-[#2196F3] to-[#1976D2] text-white rounded-xl print:rounded-md text-lg print:text-[9px] shadow-md">
                      {item.score}
                    </span>
                  </div>
                  <div className="px-3 py-3 print:px-1 print:py-1 text-center border-l-2 border-gray-100 flex items-center justify-center">
                    <span className="text-sm print:text-[8px] text-gray-700">{item.grade}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Panel - Visualization */}
          <div className="bg-gradient-to-br from-[#E3F2FD] to-[#BBDEFB]">
            <div className="px-4 py-3 print:px-2 print:py-1.5 bg-gradient-to-r from-[#BBDEFB] to-[#90CAF9] border-b-2 border-[#2196F3]">
              <h3 className="text-center text-gray-800 text-base print:text-[10px] tracking-wide">Point Spread Analysis</h3>
            </div>
            <div className="flex items-center justify-center p-6 print:p-2">
              <RadarChart
                width={500}
                height={460}
                data={radarData}
                margin={{ top: 40, right: 70, bottom: 40, left: 70 }}
              >
                <defs>
                  <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2196F3" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#64B5F6" stopOpacity={0.3}/>
                  </linearGradient>
                </defs>
                <PolarGrid 
                  stroke="#2196F3" 
                  strokeWidth={1.5}
                  strokeOpacity={0.3}
                />
                <PolarAngleAxis
                  dataKey="subject"
                  tick={{ fill: '#1565C0', fontSize: 14, fontWeight: 600 }}
                  tickLine={false}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 6]}
                  tick={{ fill: '#1976D2', fontSize: 12, fontWeight: 600 }}
                  axisLine={{ stroke: '#2196F3', strokeWidth: 1.5 }}
                />
                <Radar
                  name="Performance"
                  dataKey="value"
                  stroke="#1976D2"
                  fill="url(#colorScore)"
                  strokeWidth={2.5}
                />
                <Radar
                  dataKey="fullMark"
                  stroke="#FFA726"
                  fill="transparent"
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                  strokeOpacity={0.6}
                />
              </RadarChart>
            </div>
          </div>
        </div>

        {/* Evaluation Criteria Legend */}
        <div className="bg-gradient-to-r from-[#1976D2] to-[#2196F3] text-white px-6 py-3 print:px-2 print:py-1 border-t-2 border-[#1565C0]">
          <div className="text-center mb-2 print:mb-0.5 text-sm print:text-[7px] uppercase tracking-widest opacity-95">Grading Scale</div>
          <div className="flex flex-wrap justify-center gap-2 print:gap-1 text-sm print:text-[8px]">
            <div className="flex items-center gap-1.5 print:gap-0.5 bg-white/15 px-2 py-1.5 print:px-1.5 print:py-0.5 rounded-lg print:rounded-md backdrop-blur-sm border border-white/20">
              <span className="w-7 h-7 print:w-4 print:h-4 bg-white/25 rounded-lg print:rounded-md flex items-center justify-center text-sm print:text-[8px]">P</span>
              <span>Perfect</span>
            </div>
            <div className="flex items-center gap-1.5 print:gap-0.5 bg-white/15 px-2 py-1.5 print:px-1.5 print:py-0.5 rounded-lg print:rounded-md backdrop-blur-sm border border-white/20">
              <span className="w-7 h-7 print:w-4 print:h-4 bg-white/25 rounded-lg print:rounded-md flex items-center justify-center text-sm print:text-[8px]">E</span>
              <span>Excellent</span>
            </div>
            <div className="flex items-center gap-1.5 print:gap-0.5 bg-white/15 px-2 py-1.5 print:px-1.5 print:py-0.5 rounded-lg print:rounded-md backdrop-blur-sm border border-white/20">
              <span className="w-7 h-7 print:w-4 print:h-4 bg-white/25 rounded-lg print:rounded-md flex items-center justify-center text-sm print:text-[8px]">GR</span>
              <span>Great</span>
            </div>
            <div className="flex items-center gap-1.5 print:gap-0.5 bg-white/15 px-2 py-1.5 print:px-1.5 print:py-0.5 rounded-lg print:rounded-md backdrop-blur-sm border border-white/20">
              <span className="w-7 h-7 print:w-4 print:h-4 bg-white/25 rounded-lg print:rounded-md flex items-center justify-center text-sm print:text-[8px]">G</span>
              <span>Good</span>
            </div>
            <div className="flex items-center gap-1.5 print:gap-0.5 bg-white/15 px-2 py-1.5 print:px-1.5 print:py-0.5 rounded-lg print:rounded-md backdrop-blur-sm border border-white/20">
              <span className="w-7 h-7 print:w-4 print:h-4 bg-white/25 rounded-lg print:rounded-md flex items-center justify-center text-sm print:text-[8px]">VG</span>
              <span>Very Good</span>
            </div>
            <div className="flex items-center gap-1.5 print:gap-0.5 bg-white/15 px-2 py-1.5 print:px-1.5 print:py-0.5 rounded-lg print:rounded-md backdrop-blur-sm border border-white/20">
              <span className="w-7 h-7 print:w-4 print:h-4 bg-white/25 rounded-lg print:rounded-md flex items-center justify-center text-sm print:text-[8px]">NI</span>
              <span>Need Improvement</span>
            </div>
          </div>
        </div>

        {/* Comments Section */}
        <div className="border-t-2 border-gray-200">
          <div className="bg-gradient-to-r from-[#BBDEFB] to-[#90CAF9] px-4 py-2 print:px-2 print:py-0.5 border-b-2 border-[#2196F3]">
            <h3 className="text-center text-gray-800 text-base print:text-[9px] tracking-wide">Teacher's Comments</h3>
          </div>
          <div className="bg-gradient-to-br from-[#E1F5FE] to-[#B3E5FC] px-6 py-3 print:px-2 print:py-1 min-h-[60px] print:min-h-[30px]">
            <div className="bg-white/80 backdrop-blur-sm rounded-xl print:rounded-md p-3 print:p-1.5 border-2 border-white shadow-lg">
              <p className="text-gray-800 leading-relaxed text-base print:text-[9px] print:leading-tight">{student.comments}</p>
            </div>
          </div>
        </div>

        {/* Premium Footer */}
        <div className="bg-gradient-to-r from-[#1565C0] to-[#1976D2] text-white px-6 py-2 print:px-2 print:py-0.5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32 print:hidden"></div>
          <div className="relative flex items-center justify-between text-xs print:text-[7px]">
            <div className="flex items-center gap-2 print:gap-1">
              <div className="w-2 h-2 print:w-1 print:h-1 bg-white rounded-full animate-pulse shadow-lg"></div>
              <span className="tracking-wide">Academic Assessment Report • Bakkum Academy</span>
            </div>
            <div className="flex items-center gap-2 print:gap-1">
              <Calendar className="w-3 h-3 print:w-2 print:h-2 opacity-90" />
              <span>Generated on {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== 핸드폰 전송용 분할 저장 레이아웃 (화면 밖, 캡처 전용) ===== */}
      <div style={{ position: 'absolute', left: '-99999px', top: 0 }} aria-hidden="true">
        {/* --- 1장: 학원 정보 + 평가표 --- */}
        <div ref={page1Ref} style={{ width: '820px' }} className="bg-white border-2 border-gray-100 rounded-3xl overflow-hidden mb-12">
          <div className="bg-gradient-to-r from-[#1976D2] via-[#2196F3] to-[#42A5F5] text-white px-10 py-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-5">
                <div className="w-24 h-24 bg-white/15 rounded-3xl flex items-center justify-center border-2 border-white/30 shadow-xl">
                  <GraduationCap className="w-14 h-14 text-white drop-shadow-lg" />
                </div>
                <div>
                  <h1 className="text-5xl mb-2 tracking-tight">바꿈영수학원</h1>
                  <p className="text-xl opacity-95 tracking-wide">Bakkum English &amp; Math Academy</p>
                </div>
              </div>
              <div className="text-right bg-white/10 rounded-2xl px-7 py-5 border border-white/20">
                <div className="text-lg opacity-95 mb-1 tracking-wide">Student Progress Report</div>
                <div className="text-4xl tracking-tight">성적표</div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-[#E3F2FD] to-[#BBDEFB] px-10 py-7 border-b-2 border-[#2196F3]">
            <div className="grid grid-cols-2 gap-x-12 gap-y-4 text-2xl">
              <div className="flex gap-3"><span className="text-[#1565C0] opacity-80">학생</span><span className="text-gray-900 font-semibold">{student.studentName}</span></div>
              <div className="flex gap-3"><span className="text-[#1565C0] opacity-80">선생님</span><span className="text-gray-900">{student.teacherName}</span></div>
              <div className="flex gap-3"><span className="text-[#1565C0] opacity-80">평가월</span><span className="text-gray-900">{formatEvaluationMonth(student.evaluationMonth)}</span></div>
              <div className="flex gap-3"><span className="text-[#1565C0] opacity-80">학년</span><span className="text-gray-900">Grade {student.grade}</span></div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-[#BBDEFB] to-[#90CAF9] px-6 py-5 border-b-2 border-[#2196F3]">
            <h3 className="text-center text-gray-800 text-3xl tracking-wide">Categorized Evaluation</h3>
          </div>

          <div className="grid grid-cols-[3fr_1.2fr_2fr] bg-gradient-to-r from-[#E3F2FD] to-[#BBDEFB] border-b-2 border-[#90CAF9] text-xl text-[#1565C0] uppercase tracking-wider">
            <div className="px-8 py-5">Criteria</div>
            <div className="px-3 py-5 text-center border-l-2 border-white">Score</div>
            <div className="px-3 py-5 text-center border-l-2 border-white">Grade</div>
          </div>

          <div className="divide-y-2 divide-gray-100">
            {student.evaluations.map((item, index) => (
              <div key={index} className="grid grid-cols-[3fr_1.2fr_2fr]">
                <div className="px-8 py-5">
                  <div className="text-gray-900 text-3xl">{item.criteria}</div>
                  <div className="text-xl text-gray-500 mt-1">{item.criteriaKo}</div>
                </div>
                <div className="px-3 py-5 text-center border-l-2 border-gray-100 flex items-center justify-center">
                  <span className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-[#2196F3] to-[#1976D2] text-white rounded-2xl text-3xl shadow-md">{item.score}</span>
                </div>
                <div className="px-3 py-5 text-center border-l-2 border-gray-100 flex items-center justify-center">
                  <span className="text-2xl text-gray-700">{item.grade}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* --- 2장: 그래프 + 등급기준 + 코멘트 --- */}
        <div ref={page2Ref} style={{ width: '820px' }} className="bg-white border-2 border-gray-100 rounded-3xl overflow-hidden">
          <div className="bg-gradient-to-r from-[#1976D2] to-[#42A5F5] text-white px-10 py-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GraduationCap className="w-10 h-10" />
              <span className="text-3xl tracking-tight">바꿈영수학원</span>
            </div>
            <span className="text-xl opacity-95">{student.studentName} · {formatEvaluationMonth(student.evaluationMonth)}</span>
          </div>

          <div className="bg-gradient-to-r from-[#BBDEFB] to-[#90CAF9] px-6 py-5 border-b-2 border-[#2196F3]">
            <h3 className="text-center text-gray-800 text-3xl tracking-wide">Point Spread Analysis</h3>
          </div>
          <div className="bg-gradient-to-br from-[#E3F2FD] to-[#BBDEFB] flex items-center justify-center py-8">
            <RadarChart width={780} height={640} data={radarData} margin={{ top: 70, right: 120, bottom: 70, left: 120 }}>
              <defs>
                <linearGradient id="colorScoreExport" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2196F3" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#64B5F6" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <PolarGrid stroke="#2196F3" strokeWidth={1.5} strokeOpacity={0.3} />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#1565C0', fontSize: 20, fontWeight: 600 }} tickLine={false} />
              <PolarRadiusAxis angle={90} domain={[0, 6]} tick={{ fill: '#1976D2', fontSize: 16, fontWeight: 600 }} axisLine={{ stroke: '#2196F3', strokeWidth: 1.5 }} />
              <Radar name="Performance" dataKey="value" stroke="#1976D2" fill="url(#colorScoreExport)" strokeWidth={3} />
              <Radar dataKey="fullMark" stroke="#FFA726" fill="transparent" strokeWidth={1.5} strokeDasharray="6 3" strokeOpacity={0.6} />
            </RadarChart>
          </div>

          <div className="bg-gradient-to-r from-[#1976D2] to-[#2196F3] text-white px-8 py-6 border-t-2 border-[#1565C0]">
            <div className="text-center mb-3 text-lg uppercase tracking-widest opacity-95">Grading Scale</div>
            <div className="flex flex-wrap justify-center gap-3 text-2xl">
              {([['P', 'Perfect'], ['E', 'Excellent'], ['GR', 'Great'], ['G', 'Good'], ['VG', 'Very Good'], ['NI', 'Need Improvement']] as const).map(([k, label]) => (
                <div key={k} className="flex items-center gap-2 bg-white/15 px-4 py-2 rounded-xl border border-white/20">
                  <span className="w-11 h-11 bg-white/25 rounded-lg flex items-center justify-center text-lg">{k}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gradient-to-r from-[#BBDEFB] to-[#90CAF9] px-6 py-4 border-y-2 border-[#2196F3]">
            <h3 className="text-center text-gray-800 text-3xl tracking-wide">Teacher's Comments</h3>
          </div>
          <div className="bg-gradient-to-br from-[#E1F5FE] to-[#B3E5FC] px-8 py-7">
            <div className="bg-white/80 rounded-2xl p-7 border-2 border-white shadow-lg min-h-[120px]">
              <p className="text-gray-800 leading-relaxed text-2xl whitespace-pre-wrap">{student.comments}</p>
            </div>
          </div>

          <div className="bg-gradient-to-r from-[#1565C0] to-[#1976D2] text-white px-8 py-4 flex items-center justify-between text-lg">
            <span className="tracking-wide">Academic Assessment Report • Bakkum Academy</span>
            <span>{new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
        </div>
      </div>

      {/* Print Guide Modal */}
      {showPrintGuide && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border-2 border-[#90CAF9]">
            <div className="bg-gradient-to-r from-[#2196F3] to-[#1976D2] text-white px-6 py-5 rounded-t-2xl sticky top-0 z-10">
              <h2 className="text-2xl">💾 성적표 저장 방법</h2>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="border-l-4 border-blue-500 pl-4 py-2 bg-blue-50 rounded-r-lg">
                <h3 className="text-lg mb-3 text-gray-900">📄 PDF로 저장하기</h3>
                <ol className="list-decimal list-inside space-y-2 text-gray-700">
                  <li><strong>"인쇄하기"</strong> 버튼을 클릭하세요</li>
                  <li>인쇄 대화상자에서 <strong>"대상"</strong> 또는 <strong>"프린터"</strong>를 선택하세요</li>
                  <li><strong>"PDF로 저장"</strong> 또는 <strong>"Microsoft Print to PDF"</strong>를 선택하세요</li>
                  <li>저장 위치를 선택하고 <strong>"저장"</strong>을 클릭하세요</li>
                </ol>
              </div>

              <div className="border-l-4 border-green-500 pl-4 py-2 bg-green-50 rounded-r-lg">
                <h3 className="text-lg mb-3 text-gray-900">🖼️ 이미지로 저장하기</h3>
                <ol className="list-decimal list-inside space-y-2 text-gray-700">
                  <li><strong>Windows:</strong> Win + Shift + S (캡처 도구)</li>
                  <li><strong>Mac:</strong> Cmd + Shift + 4 (영역 캡처)</li>
                  <li>성적표 영역을 선택하여 캡처하세요</li>
                  <li>클립보드에서 붙여넣기 또는 자동 저장됩니다</li>
                </ol>
              </div>

              <div className="border-l-4 border-purple-500 pl-4 py-2 bg-purple-50 rounded-r-lg">
                <h3 className="text-lg mb-3 text-gray-900">⚡ 빠른 방법 (단축키)</h3>
                <p className="text-gray-700">
                  <strong>Ctrl + P</strong> (Windows) 또는 <strong>Cmd + P</strong> (Mac)를 눌러 바로 인쇄 대화상자를 열 수 있습니다.
                </p>
              </div>

              <div className="bg-yellow-50 border-l-4 border-yellow-500 pl-4 py-3 rounded-r-lg">
                <p className="text-sm text-gray-800">
                  <strong>💡 팁:</strong> PDF로 저장하면 높은 품질로 보관할 수 있으며, 이메일로 전송하기에도 편리합니다.
                </p>
              </div>
            </div>

            <div className="p-6 pt-0">
              <button
                type="button"
                onClick={() => setShowPrintGuide(false)}
                className="w-full bg-gradient-to-r from-[#2196F3] to-[#1976D2] hover:from-[#1E88E5] hover:to-[#1565C0] text-white px-6 py-3 rounded-xl shadow-lg transition-all hover:shadow-xl"
              >
                확인했습니다
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}