export type Difficulty = 'low' | 'mid' | 'high';

export interface Player {
  id: number;
  name: string;
  grade: number;
  position: number;
  money: number;
  color: string;
  isJailed?: boolean;
  isBankrupt?: boolean;
}

export interface Space {
  id: number;
  type: 'start' | 'land' | 'jail' | 'chance' | 'challenge';
  name: string;
  price?: number;
  rent?: number;
  ownerId?: number | null;
  colorGroup?: string;
  level?: number; // 1: 기지, 2: 연구소, 3: 랜드마크
}

export interface MathProblemData {
  question: string;
  answer: string;
  explanation?: string;
}

export interface MathProblemResponse {
  grade: number;
  type: 'math_problem' | 'jail_problem' | 'chance_card';
  data?: {
    low?: MathProblemData;
    mid?: MathProblemData;
    high?: MathProblemData;
  };
  jail_problems?: string[];
  jail_answers?: string[];
  chance_text?: string;
  chance_effect?: string;
}
