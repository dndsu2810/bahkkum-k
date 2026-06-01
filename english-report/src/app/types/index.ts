export interface EvaluationItem {
  criteria: string;
  criteriaKo: string;
  score: string;
  grade: string;
}

export interface Student {
  id: string;
  studentName: string;
  teacherName: string;
  evaluationMonth: string;
  grade: string;
  evaluations: EvaluationItem[];
  comments: string;
}

export type ScoreType = 'P' | 'E' | 'GR' | 'G' | 'VG' | 'NI';

export const SCORE_OPTIONS: { value: ScoreType; label: string; fullName: string }[] = [
  { value: 'P', label: 'P', fullName: 'Perfect' },
  { value: 'E', label: 'E', fullName: 'Excellent' },
  { value: 'GR', label: 'GR', fullName: 'Great' },
  { value: 'G', label: 'G', fullName: 'Good' },
  { value: 'VG', label: 'VG', fullName: 'Very Good' },
  { value: 'NI', label: 'NI', fullName: 'Need Improvement' }
];
