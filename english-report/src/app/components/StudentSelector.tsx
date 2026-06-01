import { Plus, Trash2, Edit2, Upload, Calendar, UserPlus } from 'lucide-react';
import type { Student } from '../types';

interface StudentSelectorProps {
  students: Student[];
  selectedStudentId: string | null;
  onSelectStudent: (student: Student) => void;
  onAddStudent: () => void;
  onDeleteStudent: (id: string) => void;
  onEdit: (student: Student) => void;
  onImport: () => void;
}

export function StudentSelector({
  students,
  selectedStudentId,
  onSelectStudent,
  onAddStudent,
  onDeleteStudent,
  onEdit,
  onImport
}: StudentSelectorProps) {
  const selectedStudent = students.find(s => s.id === selectedStudentId);

  return (
    <div className="mb-8 bg-white rounded-2xl shadow-xl p-6 border-2 border-[#90CAF9]">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl text-[#1976D2]">학생 선택</h2>
        <div className="flex gap-3">
          <button
            onClick={onAddStudent}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#2196F3] to-[#1976D2] text-white rounded-xl hover:from-[#1E88E5] hover:to-[#1565C0] transition-all shadow-lg hover:shadow-xl"
          >
            <UserPlus className="w-4 h-4" />
            새 학생
          </button>
          <button
            onClick={onImport}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-[#64B5F6] to-[#2196F3] text-white rounded-xl hover:from-[#42A5F5] hover:to-[#1976D2] transition-all shadow-lg hover:shadow-xl"
          >
            <Upload className="w-4 h-4" />
            데이터 불러오기
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {students.map((student) => (
          <div
            key={student.id}
            onClick={() => onSelectStudent(student)}
            className={`p-5 rounded-xl border-2 cursor-pointer transition-all ${
              selectedStudent?.id === student.id
                ? 'border-[#2196F3] bg-gradient-to-br from-[#E3F2FD] to-[#BBDEFB] shadow-xl'
                : 'border-gray-200 hover:border-[#90CAF9] hover:shadow-lg'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-lg text-gray-900 mb-1">{student.studentName}</h3>
                <p className="text-sm text-gray-600">선생님: {student.teacherName}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(student);
                  }}
                  className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  <Edit2 className="w-4 h-4 text-[#2196F3]" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('이 학생을 삭제하시겠습니까?')) {
                      onDeleteStudent(student.id);
                    }
                  }}
                  className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Calendar className="w-4 h-4" />
              <span>{student.evaluationMonth}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}