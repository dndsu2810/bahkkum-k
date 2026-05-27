// 약수·배수 풍선 게임 미션 생성기 (5학년 약수와 배수 단원).
// 미션 6종: 약수 / 배수 / 공약수 / 공배수 / 소수 / 진약수

export type MissionType =
  | "약수"
  | "배수"
  | "공약수"
  | "공배수"
  | "소수"
  | "진약수";

export type Mission = {
  type: MissionType;
  text: string; // HUD에 표시: "18의 약수만 잡아!"
  isCorrect: (n: number) => boolean;
};

export type MissionSet = {
  mission: Mission;
  corrects: number[]; // 1..max 중 정답 숫자
  wrongs: number[]; // 1..max 중 오답 숫자
};

export function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildMission(max: number): Mission {
  const type = pick<MissionType>([
    "약수",
    "배수",
    "공약수",
    "공배수",
    "소수",
    "진약수",
  ]);

  switch (type) {
    case "약수": {
      // 약수가 여럿인 합성수를 base 로
      const base = pick([12, 16, 18, 20, 24, 28, 30, 36, 40, 48].filter((b) => b <= max));
      return {
        type,
        text: `${base}의 약수만 잡아!`,
        isCorrect: (n) => n >= 1 && base % n === 0,
      };
    }
    case "배수": {
      const base = randInt(2, 9);
      return {
        type,
        text: `${base}의 배수만 잡아!`,
        isCorrect: (n) => n >= base && n % base === 0,
      };
    }
    case "공약수": {
      const candidates = [12, 16, 18, 20, 24, 28, 30, 36, 40, 48].filter((b) => b <= max);
      const b1 = pick(candidates);
      // 두 수가 서로 다르고 공약수가 1보다 많이 있는 조합만 (서로소·자기자신 회피)
      const goodB2 = candidates.filter((b) => b !== b1 && gcd(b, b1) > 1);
      if (goodB2.length === 0) {
        // 폴백: 그냥 약수 미션으로 (헷갈리지 않게)
        return {
          type: "약수",
          text: `${b1}의 약수만 잡아!`,
          isCorrect: (n) => n >= 1 && b1 % n === 0,
        };
      }
      const b2 = pick(goodB2);
      return {
        type,
        text: `${b1}과(와) ${b2}의 공약수만!`,
        isCorrect: (n) => n >= 1 && b1 % n === 0 && b2 % n === 0,
      };
    }
    case "공배수": {
      const b1 = randInt(2, 5);
      let b2 = randInt(2, 6);
      while (b2 === b1) b2 = randInt(2, 6);
      return {
        type,
        text: `${b1}과(와) ${b2}의 공배수만!`,
        isCorrect: (n) => n >= 1 && n % b1 === 0 && n % b2 === 0,
      };
    }
    case "소수": {
      // 초등학생이 '소수'를 십진수(0.6 등)로 오해하지 않도록 풀어서 설명
      return {
        type,
        text: `약수가 2개뿐인 수만! (1과 자기 자신)`,
        isCorrect: (n) => isPrime(n),
      };
    }
    case "진약수": {
      const base = pick([12, 16, 18, 20, 24, 28, 30, 36].filter((b) => b <= max));
      return {
        type,
        text: `${base}의 진약수만! (1과 자기 자신 빼고)`,
        isCorrect: (n) => n > 1 && n < base && base % n === 0,
      };
    }
  }
}

/** 정답이 충분히 들어있는 미션을 생성. (1..max 안에 정답≥3, 오답≥6) */
export function generateMissionSet(max: number): MissionSet {
  for (let attempt = 0; attempt < 60; attempt++) {
    const mission = buildMission(max);
    const corrects: number[] = [];
    const wrongs: number[] = [];
    for (let n = 1; n <= max; n++) {
      if (mission.isCorrect(n)) corrects.push(n);
      else wrongs.push(n);
    }
    if (corrects.length >= 3 && wrongs.length >= 6) {
      return { mission, corrects, wrongs };
    }
  }
  // 안전망: 짝수 미션
  const corrects: number[] = [];
  const wrongs: number[] = [];
  for (let n = 1; n <= max; n++) (n % 2 === 0 ? corrects : wrongs).push(n);
  return {
    mission: { type: "배수", text: "2의 배수(짝수)만 잡아!", isCorrect: (n) => n % 2 === 0 },
    corrects,
    wrongs,
  };
}
