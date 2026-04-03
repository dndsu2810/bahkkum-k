import { GoogleGenAI, Type } from '@google/genai';
import { MathProblemResponse } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateMathEvent(grade: number, event: string): Promise<MathProblemResponse> {
  const prompt = `당신은 초등학생(2학년~6학년) 대상 보드게임 '매스폴리(수학 땅따먹기)'의 메인 시스템이자 수학 교육 전문가입니다.
사용자가 플레이어의 학년과 현재 게임 상황을 JSON 형태로 전달하면, 상황과 학년 수준에 완벽히 맞는 수학 문제나 게임 이벤트를 생성하여 JSON 형식으로만 응답해야 합니다.

[게임 기본 규칙]
1. 타겟 학년: 초등 2학년 ~ 6학년
2. 공정성: 학년이 달라도 각자의 학년 교과과정에 맞는 문제가 출제되어야 합니다.
3. 난이도(하/중/상):
- 하: 단순 연산, 매우 쉬운 기초
- 중: 2~3단계의 연산이나 약간의 사고력이 필요한 문제
- 상: 응용 문제, 문장제 문제, 또는 복잡한 연산 (성공 시 큰 보상)

[상황별 출력 요구사항]
1. event가 "land_purchase" (빈 땅 도착), "upgrade" (건물 업그레이드), "takeover" (상대 땅 인수), "challenge" (도전장) 일 때:
- 해당 학년에 맞는 수학 문제를 '하, 중, 상' 3가지 난이도로 모두 생성합니다.
- 응답 필드: type은 "math_problem", data 안에 low, mid, high 객체 (각각 question, answer, 상 난이도는 explanation 포함)

2. event가 "math_jail" (수학 감옥) 일 때:
- 제한 시간 내에 풀어야 하므로, 해당 학년 수준의 '빠른 암산'이 가능한 쉬운 문제 3개를 배열로 생성합니다.
- 응답 필드: type은 "jail_problem", jail_problems (배열), jail_answers (배열)

3. event가 "chance_card" (찬스 카드) 일 때:
- 게임의 판도를 바꿀 수 있는 재미있는 텍스트와 효과(효과 코드)를 생성합니다.
- 응답 필드: type은 "chance_card", chance_text, chance_effect (예: MULTIPLY_DICE, FORCE_HIGH_DIFF, ESCAPE_JAIL, GET_MONEY, LOSE_MONEY)

[입력]
{"grade": ${grade}, "event": "${event}"}

반드시 JSON 포맷으로만 응답하세요. 마크다운이나 추가 설명은 절대 넣지 마세요.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.7,
      },
    });

    const text = response.text || '{}';
    return JSON.parse(text) as MathProblemResponse;
  } catch (error) {
    console.error('Failed to generate math problem:', error);
    // Fallback response in case of error
    return {
      grade,
      type: 'math_problem',
      data: {
        low: { question: '1 + 1 = ?', answer: '2' },
        mid: { question: '2 + 2 = ?', answer: '4' },
        high: { question: '3 + 3 = ?', answer: '6', explanation: '3 더하기 3은 6입니다.' }
      }
    };
  }
}
