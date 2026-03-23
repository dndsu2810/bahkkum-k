import { Space } from './types';

export const BOARD_SPACES: Space[] = [
  { id: 0, type: 'start', name: '출발' },
  { id: 1, type: 'land', name: '덧셈 마을', price: 100, rent: 20, colorGroup: 'bg-pink-400' },
  { id: 2, type: 'land', name: '뺄셈 마을', price: 100, rent: 20, colorGroup: 'bg-pink-400' },
  { id: 3, type: 'land', name: '구구단 시티', price: 150, rent: 30, colorGroup: 'bg-orange-400' },
  { id: 4, type: 'land', name: '나눗셈 시티', price: 150, rent: 30, colorGroup: 'bg-orange-400' },
  { id: 5, type: 'jail', name: '수학 감옥' },
  { id: 6, type: 'land', name: '분수 아일랜드', price: 200, rent: 40, colorGroup: 'bg-yellow-400' },
  { id: 7, type: 'land', name: '소수 아일랜드', price: 200, rent: 40, colorGroup: 'bg-yellow-400' },
  { id: 8, type: 'land', name: '도형 왕국', price: 250, rent: 50, colorGroup: 'bg-green-400' },
  { id: 9, type: 'land', name: '각도 왕국', price: 250, rent: 50, colorGroup: 'bg-green-400' },
  { id: 10, type: 'chance', name: '찬스 카드' },
  { id: 11, type: 'land', name: '비례식 행성', price: 300, rent: 60, colorGroup: 'bg-blue-400' },
  { id: 12, type: 'land', name: '방정식 행성', price: 300, rent: 60, colorGroup: 'bg-blue-400' },
  { id: 13, type: 'land', name: '확률 우주', price: 350, rent: 70, colorGroup: 'bg-indigo-400' },
  { id: 14, type: 'land', name: '통계 우주', price: 350, rent: 70, colorGroup: 'bg-indigo-400' },
  { id: 15, type: 'challenge', name: '도전장' },
  { id: 16, type: 'land', name: '규칙성 은하', price: 400, rent: 80, colorGroup: 'bg-purple-400' },
  { id: 17, type: 'land', name: '함수 은하', price: 400, rent: 80, colorGroup: 'bg-purple-400' },
  { id: 18, type: 'land', name: '논리 블랙홀', price: 500, rent: 100, colorGroup: 'bg-slate-400' },
  { id: 19, type: 'land', name: '창의력 화이트홀', price: 500, rent: 100, colorGroup: 'bg-slate-400' },
];

export const getGridPosition = (index: number) => {
  if (index >= 0 && index <= 5) return { col: 6 - index, row: 6 };
  if (index >= 6 && index <= 10) return { col: 1, row: 6 - (index - 5) };
  if (index >= 11 && index <= 15) return { col: 1 + (index - 10), row: 1 };
  if (index >= 16 && index <= 19) return { col: 6, row: 1 + (index - 15) };
  return { col: 1, row: 1 };
};
