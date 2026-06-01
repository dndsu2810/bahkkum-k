import { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import type { Student } from '../types';

interface ImportStudentModalProps {
  onImport: (student: Student) => void;
  onClose: () => void;
}

export function ImportStudentModal({ onImport, onClose }: ImportStudentModalProps) {
  const [jsonInput, setJsonInput] = useState('');
  const [error, setError] = useState('');

  const handleImport = () => {
    try {
      setError('');
      const parsed = JSON.parse(jsonInput);
      
      // Validate structure
      if (!parsed.studentName || !parsed.evaluations || !Array.isArray(parsed.evaluations)) {
        setError('올바른 형식이 아닙니다. 필수 필드를 확인해주세요.');
        return;
      }

      if (parsed.evaluations.length !== 8) {
        setError('평가 항목은 8개여야 합니다.');
        return;
      }

      const student: Student = {
        id: '', // Will be assigned by parent
        studentName: parsed.studentName || '',
        teacherName: parsed.teacherName || '',
        evaluationMonth: parsed.evaluationMonth || new Date().toISOString().split('T')[0],
        grade: parsed.grade || '1',
        evaluations: parsed.evaluations,
        comments: parsed.comments || ''
      };

      onImport(student);
    } catch (e) {
      setError('JSON 형식이 올바르지 않습니다. 데이터를 확인해주세요.');
    }
  };

  const exampleData = {
    studentName: '홍길동',
    teacherName: 'John Smith',
    evaluationMonth: '2025-01-31',
    grade: '3',
    evaluations: [
      { criteria: 'Listening', criteriaKo: '[듣기]', score: 'E', grade: 'Excellent' },
      { criteria: 'Reading', criteriaKo: '[읽기]', score: 'GR', grade: 'Great' },
      { criteria: 'Speaking', criteriaKo: '[회화·발표]', score: 'P', grade: 'Perfect' },
      { criteria: 'Spelling•Writing', criteriaKo: '[철자·영작]', score: 'G', grade: 'Good' },
      { criteria: 'Comprehension', criteriaKo: '[이해]', score: 'E', grade: 'Excellent' },
      { criteria: 'Learning Attitude', criteriaKo: '[태도]', score: 'GR', grade: 'Great' },
      { criteria: 'Task Performance', criteriaKo: '[수행]', score: 'VG', grade: 'Very Good' },
      { criteria: 'Confidence', criteriaKo: '[자신감]', score: 'E', grade: 'Excellent' }
    ],
    comments: '매우 우수한 학습 태도를 보이고 있습니다.'
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border-2 border-[#90CAF9]">
        <div className="bg-gradient-to-r from-[#2196F3] to-[#1976D2] text-white px-6 py-5 rounded-t-2xl sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-xl">학생 데이터 불러오기</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6">
          <div className="mb-6">
            <label className="block text-sm mb-3 text-gray-700">
              학생 데이터를 JSON 형식으로 붙여넣으세요
            </label>
            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder='예시: {"studentName":"홍길동","teacherName":"김선생",...}'
              className="w-full h-64 px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:border-[#2196F3] transition-colors font-mono text-sm"
            />
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border-2 border-red-200 rounded-xl text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-6 py-3 border-2 border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleImport}
              className="px-6 py-3 bg-gradient-to-r from-[#2196F3] to-[#1976D2] text-white rounded-xl hover:from-[#1E88E5] hover:to-[#1565C0] transition-all shadow-lg hover:shadow-xl"
            >
              데이터 가져오기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}