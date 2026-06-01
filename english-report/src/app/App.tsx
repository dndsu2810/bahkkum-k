import { useState } from 'react';
import { ReportCard } from './components/ReportCard';
import { StudentSelector } from './components/StudentSelector';
import { StudentForm } from './components/StudentForm';
import { ImportStudentModal } from './components/ImportStudentModal';
import type { Student } from './types';

export default function App() {
  const [students, setStudents] = useState<Student[]>([]);

  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const selectedStudent = students.find(s => s.id === selectedStudentId);

  const handleAddStudent = () => {
    const newStudent: Student = {
      id: Date.now().toString(),
      studentName: '새 학생',
      teacherName: '',
      evaluationMonth: new Date().toISOString().split('T')[0],
      grade: '1',
      evaluations: [
        { criteria: 'Listening', criteriaKo: '[듣기]', score: 'G', grade: 'Good' },
        { criteria: 'Reading', criteriaKo: '[읽기]', score: 'G', grade: 'Good' },
        { criteria: 'Speaking', criteriaKo: '[회화·발표]', score: 'G', grade: 'Good' },
        { criteria: 'Spelling•Writing', criteriaKo: '[철자·영작]', score: 'G', grade: 'Good' },
        { criteria: 'Comprehension', criteriaKo: '[이해]', score: 'G', grade: 'Good' },
        { criteria: 'Learning Attitude', criteriaKo: '[태도]', score: 'G', grade: 'Good' },
        { criteria: 'Task Performance', criteriaKo: '[수행]', score: 'G', grade: 'Good' },
        { criteria: 'Confidence', criteriaKo: '[자신감]', score: 'G', grade: 'Good' }
      ],
      comments: ''
    };
    setStudents([...students, newStudent]);
    setSelectedStudentId(newStudent.id);
    setIsEditing(true);
  };

  const handleDeleteStudent = (id: string) => {
    setStudents(students.filter(s => s.id !== id));
    if (selectedStudentId === id) {
      setSelectedStudentId(students[0]?.id || null);
    }
  };

  const handleUpdateStudent = (updatedStudent: Student) => {
    setStudents(students.map(s => s.id === updatedStudent.id ? updatedStudent : s));
    setIsEditing(false);
  };

  const handleImportStudent = (importedStudent: Student) => {
    const newStudent = { ...importedStudent, id: Date.now().toString() };
    setStudents([...students, newStudent]);
    setSelectedStudentId(newStudent.id);
    setIsImportModalOpen(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#E3F2FD] via-[#BBDEFB] to-[#90CAF9] py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl mb-2 text-[#1565C0]">바꿈영수학원 성적표 시스템</h1>
          <p className="text-[#1976D2]">Bakkum English & Math Academy - Student Report Card System</p>
        </div>

        <div className="mb-6">
          <StudentSelector
            students={students}
            selectedStudentId={selectedStudentId}
            onSelectStudent={(student) => setSelectedStudentId(student.id)}
            onAddStudent={handleAddStudent}
            onDeleteStudent={handleDeleteStudent}
            onEdit={(student) => {
              setSelectedStudentId(student.id);
              setIsEditing(true);
            }}
            onImport={() => setIsImportModalOpen(true)}
          />
        </div>

        {selectedStudent && (
          <>
            {isEditing ? (
              <div className="bg-white shadow-lg rounded-lg p-6 max-w-4xl mx-auto">
                <StudentForm
                  student={selectedStudent}
                  onSave={handleUpdateStudent}
                  onCancel={() => setIsEditing(false)}
                />
              </div>
            ) : (
              <ReportCard student={selectedStudent} />
            )}
          </>
        )}

        {!selectedStudent && students.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">학생이 없습니다. 새 학생을 추가해주세요.</p>
          </div>
        )}
      </div>

      {isImportModalOpen && (
        <ImportStudentModal
          onImport={handleImportStudent}
          onClose={() => setIsImportModalOpen(false)}
        />
      )}
    </div>
  );
}