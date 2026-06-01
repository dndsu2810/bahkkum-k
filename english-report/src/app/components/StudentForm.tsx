import { useState } from 'react';
import { Save, X, Edit3, Check } from 'lucide-react';
import type { Student } from '../types';
import { SCORE_OPTIONS } from '../types';

interface StudentFormProps {
  student: Student;
  onSave: (student: Student) => void;
  onCancel: () => void;
}

export function StudentForm({ student, onSave, onCancel }: StudentFormProps) {
  const [formData, setFormData] = useState<Student>(student);
  const [isEditingCriteria, setIsEditingCriteria] = useState(false);

  // Parse evaluation month into year and month
  const parseEvaluationMonth = (dateStr: string) => {
    const date = new Date(dateStr);
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1
    };
  };

  const { year: initialYear, month: initialMonth } = parseEvaluationMonth(formData.evaluationMonth);
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);

  // Generate year options (current year ± 5 years)
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i);
  const months = [
    { value: 1, label: '1월' },
    { value: 2, label: '2월' },
    { value: 3, label: '3월' },
    { value: 4, label: '4월' },
    { value: 5, label: '5월' },
    { value: 6, label: '6월' },
    { value: 7, label: '7월' },
    { value: 8, label: '8월' },
    { value: 9, label: '9월' },
    { value: 10, label: '10월' },
    { value: 11, label: '11월' },
    { value: 12, label: '12월' }
  ];

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    updateEvaluationMonth(year, selectedMonth);
  };

  const handleMonthChange = (month: number) => {
    setSelectedMonth(month);
    updateEvaluationMonth(selectedYear, month);
  };

  const updateEvaluationMonth = (year: number, month: number) => {
    const lastDay = new Date(year, month, 0).getDate();
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    setFormData({ ...formData, evaluationMonth: dateStr });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const handleScoreChange = (index: number, scoreValue: string) => {
    const scoreOption = SCORE_OPTIONS.find(opt => opt.value === scoreValue);
    if (scoreOption) {
      const newEvaluations = [...formData.evaluations];
      newEvaluations[index] = {
        ...newEvaluations[index],
        score: scoreOption.value,
        grade: scoreOption.fullName
      };
      setFormData({ ...formData, evaluations: newEvaluations });
    }
  };

  const handleCriteriaChange = (index: number, field: 'criteria' | 'criteriaKo', value: string) => {
    const newEvaluations = [...formData.evaluations];
    newEvaluations[index] = {
      ...newEvaluations[index],
      [field]: value
    };
    setFormData({ ...formData, evaluations: newEvaluations });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl text-[#1976D2]">학생 정보 편집</h2>
      </div>

      {/* Basic Info */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm mb-2 text-[#1976D2]">학생 이름</label>
          <input
            type="text"
            value={formData.studentName}
            onChange={(e) => setFormData({ ...formData, studentName: e.target.value })}
            className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-[#2196F3] transition-colors"
            required
          />
        </div>
        <div>
          <label className="block text-sm mb-2 text-[#1976D2]">선생님 이름</label>
          <input
            type="text"
            value={formData.teacherName}
            onChange={(e) => setFormData({ ...formData, teacherName: e.target.value })}
            className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-[#2196F3] transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm mb-2 text-[#1976D2]">평가 월</label>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={selectedYear}
              onChange={(e) => handleYearChange(Number(e.target.value))}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-[#2196F3] transition-colors bg-white"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}년
                </option>
              ))}
            </select>
            <select
              value={selectedMonth}
              onChange={(e) => handleMonthChange(Number(e.target.value))}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-[#2196F3] transition-colors bg-white"
            >
              {months.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm mb-2 text-[#1976D2]">학년</label>
          <input
            type="text"
            value={formData.grade}
            onChange={(e) => setFormData({ ...formData, grade: e.target.value })}
            className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-[#2196F3] transition-colors"
          />
        </div>
      </div>

      {/* Evaluations */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg text-[#1976D2]">평가 항목</h3>
          <button
            type="button"
            onClick={() => setIsEditingCriteria(!isEditingCriteria)}
            className="flex items-center gap-2 px-4 py-2 text-sm border-2 border-[#2196F3] text-[#1976D2] rounded-lg hover:bg-blue-50 transition-colors"
          >
            {isEditingCriteria ? (
              <>
                <Check className="w-4 h-4" />
                항목명 편집 완료
              </>
            ) : (
              <>
                <Edit3 className="w-4 h-4" />
                항목명 수정하기
              </>
            )}
          </button>
        </div>
        <div className="space-y-3">
          {formData.evaluations.map((evaluation, index) => (
            <div key={index} className="p-4 bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg border-2 border-blue-100">
              {isEditingCriteria && (
                <div className="grid grid-cols-2 gap-3 mb-3 pb-3 border-b-2 border-blue-200">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">영문 항목명</label>
                    <input
                      type="text"
                      value={evaluation.criteria}
                      onChange={(e) => handleCriteriaChange(index, 'criteria', e.target.value)}
                      className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-[#2196F3] transition-colors text-sm"
                      placeholder="예: Listening"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">한글 항목명</label>
                    <input
                      type="text"
                      value={evaluation.criteriaKo}
                      onChange={(e) => handleCriteriaChange(index, 'criteriaKo', e.target.value)}
                      className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-[#2196F3] transition-colors text-sm"
                      placeholder="예: [듣기]"
                    />
                  </div>
                </div>
              )}
              <div className={`grid ${isEditingCriteria ? 'grid-cols-[2fr_1.5fr_2fr]' : 'grid-cols-[2fr_1.5fr_2fr]'} gap-4 items-center`}>
                <div>
                  <div className="text-sm text-gray-900">{evaluation.criteria}</div>
                  <div className="text-xs text-gray-500">{evaluation.criteriaKo}</div>
                </div>
                <div>
                  <select
                    value={evaluation.score}
                    onChange={(e) => handleScoreChange(index, e.target.value)}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-[#2196F3] transition-colors bg-white cursor-pointer"
                  >
                    {SCORE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} - {option.fullName}
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-gray-500 mt-1">
                    선택됨: <span className="inline-block px-2 py-0.5 bg-[#2196F3] text-white rounded">{evaluation.score}</span>
                  </div>
                </div>
                <div className="text-sm text-gray-700">
                  <div className="bg-white px-3 py-2 rounded-lg border border-gray-300">
                    {evaluation.grade}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Comments */}
      <div>
        <label className="block text-sm mb-2 text-[#1976D2]">코멘트</label>
        <textarea
          value={formData.comments}
          onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
          rows={5}
          className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-[#2196F3] transition-colors"
          placeholder="학생에 대한 코멘트를 입력하세요..."
        />
      </div>

      {/* Action Buttons */}
      <div className="flex justify-end gap-3 mt-6 pt-6 border-t-2 border-gray-100">
        <button
          type="button"
          onClick={onCancel}
          className="px-6 py-3 border-2 border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
        >
          취소
        </button>
        <button
          type="submit"
          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#2196F3] to-[#1976D2] text-white rounded-xl hover:from-[#1E88E5] hover:to-[#1565C0] transition-all shadow-lg hover:shadow-xl"
        >
          <Save className="w-4 h-4" />
          저장
        </button>
      </div>
    </form>
  );
}