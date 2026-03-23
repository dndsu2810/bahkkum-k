import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Trophy, Play, RotateCcw, Umbrella } from 'lucide-react';

const CANVAS_WIDTH = 500;
const CANVAS_HEIGHT = 700;
const PLAYER_SIZE = 40;
const POOP_SIZE = 30;

export default function DodgeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<'MENU' | 'PLAYING' | 'QUIZ' | 'GAMEOVER'>('MENU');
  const [score, setScore] = useState(0); // Now represents time in seconds
  const [highScores, setHighScores] = useState<{name: string, score: number}[]>([]);
  const [playerName, setPlayerName] = useState('Player');
  
  const [quiz, setQuiz] = useState({ question: '', answer: 0 });
  const [quizInput, setQuizInput] = useState('');
  const [quizTimeLeft, setQuizTimeLeft] = useState(15);

  const playerRef = useRef({ x: CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, y: CANVAS_HEIGHT - 20 - PLAYER_SIZE, vx: 0 });
  const poopsRef = useRef<{x: number, y: number, vy: number}[]>([]);
  const lastPoopZoneRef = useRef(-1);
  const frameRef = useRef(0);
  const timeRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const requestRef = useRef<number | null>(null);
  const keysRef = useRef<{[key: string]: boolean}>({});
  const difficultyRef = useRef(1);
  const levelRef = useRef(1);
  const levelUpTimerRef = useRef(0);
  const umbrellaTimerRef = useRef(0);

  useEffect(() => {
    const saved = localStorage.getItem('dodge_poop_scores_time');
    if (saved) {
      try {
        setHighScores(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const saveScore = (newScore: number) => {
    const newEntry = { name: playerName.trim() || 'Anonymous', score: newScore };
    const updated = [...highScores, newEntry].sort((a, b) => b.score - a.score).slice(0, 10);
    setHighScores(updated);
    localStorage.setItem('dodge_poop_scores_time', JSON.stringify(updated));
  };

  const startGame = () => {
    playerRef.current = { x: CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, y: CANVAS_HEIGHT - 20 - PLAYER_SIZE, vx: 0 };
    poopsRef.current = [];
    frameRef.current = 0;
    timeRef.current = 0;
    difficultyRef.current = 1;
    levelRef.current = 1;
    levelUpTimerRef.current = 0;
    umbrellaTimerRef.current = 0;
    setScore(0);
    lastTimeRef.current = performance.now();
    setGameState('PLAYING');
  };

  const gameOver = () => {
    setGameState('GAMEOVER');
    saveScore(timeRef.current);
  };

  const failQuiz = useCallback(() => {
    lastTimeRef.current = performance.now();
    setGameState('PLAYING');
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (gameState === 'QUIZ') {
      timer = setInterval(() => {
        setQuizTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            failQuiz();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [gameState, failQuiz]);

  const generateQuiz = (level: number) => {
    let num1, num2, op, answer;
    if (level < 4) {
      // Level 1~3: Double digit addition/subtraction
      num1 = Math.floor(Math.random() * 90) + 10;
      num2 = Math.floor(Math.random() * 90) + 10;
      op = Math.random() > 0.5 ? '+' : '-';
      if (op === '-' && num1 < num2) {
        const temp = num1;
        num1 = num2;
        num2 = temp;
      }
      answer = op === '+' ? num1 + num2 : num1 - num2;
    } else {
      // Level 4+: Multiplication
      num1 = Math.floor(Math.random() * 12) + 2;
      num2 = Math.floor(Math.random() * 9) + 2;
      op = 'x';
      answer = num1 * num2;
    }
    setQuiz({ question: `${num1} ${op === 'x' ? '×' : op} ${num2} = ?`, answer });
    setQuizInput('');
    setQuizTimeLeft(15);
    setGameState('QUIZ');
  };

  const handleQuizSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (parseInt(quizInput) === quiz.answer) {
      umbrellaTimerRef.current = 300; // 5 seconds of umbrella (at ~60fps)
    }
    lastTimeRef.current = performance.now(); // Reset time to prevent jump
    setGameState('PLAYING');
  };

  const update = useCallback(() => {
    if (gameState !== 'PLAYING') {
      lastTimeRef.current = performance.now();
      return;
    }

    const now = performance.now();
    const dt = (now - lastTimeRef.current) / 1000;
    lastTimeRef.current = now;

    timeRef.current += dt;
    setScore(timeRef.current);
    frameRef.current++;

    const player = playerRef.current;
    const poops = poopsRef.current;

    if (umbrellaTimerRef.current > 0) {
      umbrellaTimerRef.current--;
    }

    if (keysRef.current['ArrowLeft']) player.vx = -7;
    else if (keysRef.current['ArrowRight']) player.vx = 7;
    else player.vx = 0;

    player.x += player.vx;

    if (player.x < 0) player.x = 0;
    if (player.x > CANVAS_WIDTH - PLAYER_SIZE) player.x = CANVAS_WIDTH - PLAYER_SIZE;

    // Level up every 5 seconds (~300 frames)
    if (frameRef.current % 300 === 0) {
      difficultyRef.current += 0.3;
      levelRef.current += 1;
      levelUpTimerRef.current = 60;
    }

    // Quiz every 20 seconds (~1200 frames)
    if (frameRef.current % 1200 === 0) {
      generateQuiz(levelRef.current);
      return;
    }

    const spawnRate = Math.max(4, 30 - Math.floor(difficultyRef.current * 3));
    if (frameRef.current % spawnRate === 0) {
      const zoneWidth = CANVAS_WIDTH / 5;
      let zone;
      do {
        zone = Math.floor(Math.random() * 5);
      } while (zone === lastPoopZoneRef.current);
      lastPoopZoneRef.current = zone;
      
      const x = zone * zoneWidth + Math.random() * (zoneWidth - POOP_SIZE);

      poops.push({
        x: x,
        y: -POOP_SIZE,
        vy: (3 + Math.random() * 2) * difficultyRef.current
      });
    }

    for (let i = poops.length - 1; i >= 0; i--) {
      const p = poops[i];
      p.y += p.vy;

      const hitboxShrink = 10;
      if (
        player.x + hitboxShrink < p.x + POOP_SIZE - hitboxShrink &&
        player.x + PLAYER_SIZE - hitboxShrink > p.x + hitboxShrink &&
        player.y + hitboxShrink < p.y + POOP_SIZE - hitboxShrink &&
        player.y + PLAYER_SIZE - hitboxShrink > p.y + hitboxShrink
      ) {
        if (umbrellaTimerRef.current > 0) {
          // Umbrella protects player, destroy poop
          poops.splice(i, 1);
          continue;
        } else {
          gameOver();
          return;
        }
      }

      if (p.y > CANVAS_HEIGHT) {
        poops.splice(i, 1);
      }
    }
  }, [gameState]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#8B4513';
    ctx.fillRect(0, CANVAS_HEIGHT - 20, CANVAS_WIDTH, 20);

    if (gameState === 'PLAYING' || gameState === 'QUIZ') {
      const player = playerRef.current;
      
      // Draw Player
      ctx.font = `${PLAYER_SIZE}px Arial`;
      ctx.fillText('🏃', player.x, player.y + PLAYER_SIZE - 5);

      // Draw Player Name
      ctx.fillStyle = 'black';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(playerName.trim() || 'Player', player.x + PLAYER_SIZE / 2, player.y - 5);
      ctx.textAlign = 'left';

      // Draw Umbrella if active
      if (umbrellaTimerRef.current > 0) {
        ctx.font = `${PLAYER_SIZE}px Arial`;
        ctx.fillText('☂️', player.x, player.y - 15);
        
        ctx.beginPath();
        ctx.arc(player.x + PLAYER_SIZE / 2, player.y + PLAYER_SIZE / 2, PLAYER_SIZE * 0.9, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 255, 255, ${Math.min(1, umbrellaTimerRef.current / 30)})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Draw Poops
      ctx.font = `${POOP_SIZE}px Arial`;
      poopsRef.current.forEach(p => {
        ctx.fillText('💩', p.x, p.y + POOP_SIZE - 5);
      });

      // Draw UI (Time & Level)
      ctx.fillStyle = 'black';
      ctx.font = 'bold 24px Arial';
      ctx.fillText(`시간: ${timeRef.current.toFixed(2)}초`, 15, 35);

      ctx.textAlign = 'right';
      ctx.fillText(`Lv. ${levelRef.current}`, CANVAS_WIDTH - 15, 35);
      ctx.textAlign = 'left';

      // Draw Level Up Text
      if (levelUpTimerRef.current > 0) {
        ctx.save();
        ctx.fillStyle = `rgba(255, 69, 0, ${levelUpTimerRef.current / 60})`;
        ctx.font = 'bold 40px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('LEVEL UP!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
        ctx.restore();
        levelUpTimerRef.current--;
      }
    } else {
      ctx.font = `${PLAYER_SIZE}px Arial`;
      ctx.fillText('🏃', CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, CANVAS_HEIGHT - 20 - PLAYER_SIZE + PLAYER_SIZE - 5);
    }
  }, [gameState, playerName]);

  const loop = useCallback(() => {
    update();
    draw();
    if (gameState === 'PLAYING' || gameState === 'QUIZ') {
      requestRef.current = requestAnimationFrame(loop);
    }
  }, [update, draw, gameState]);

  useEffect(() => {
    if (gameState === 'PLAYING' || gameState === 'QUIZ') {
      requestRef.current = requestAnimationFrame(loop);
    } else {
      draw();
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, loop, draw]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { keysRef.current[e.code] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keysRef.current[e.code] = false; };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (gameState !== 'PLAYING') return;
    const touch = e.touches[0];
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    if (x < rect.width / 2) {
      keysRef.current['ArrowLeft'] = true;
      keysRef.current['ArrowRight'] = false;
    } else {
      keysRef.current['ArrowRight'] = true;
      keysRef.current['ArrowLeft'] = false;
    }
  };

  const handleTouchEnd = () => {
    keysRef.current['ArrowLeft'] = false;
    keysRef.current['ArrowRight'] = false;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-900 text-white p-4 font-sans">
      <div className="relative bg-white rounded-xl overflow-hidden shadow-2xl w-full max-w-[500px] aspect-[5/7] touch-none">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block w-full h-full"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        />

        {gameState === 'MENU' && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center p-6 text-center">
            <h1 className="text-4xl font-black text-amber-400 mb-2 drop-shadow-md">💩 똥 피하기 🏃</h1>
            <p className="text-neutral-200 mb-8">가장 오래 살아남아 1위를 차지하세요!</p>

            <div className="mb-6 w-full max-w-xs">
              <label className="block text-sm font-medium text-neutral-300 mb-1 text-left">닉네임</label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="w-full px-4 py-2 bg-neutral-800 border border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 text-white"
                placeholder="이름을 입력하세요"
                maxLength={10}
              />
            </div>

            <button
              onClick={startGame}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 px-8 rounded-full transition-transform hover:scale-105 active:scale-95 cursor-pointer"
            >
              <Play size={24} fill="currentColor" />
              게임 시작
            </button>

            {highScores.length > 0 && (
              <div className="mt-8 w-full max-w-xs bg-neutral-800/80 rounded-xl p-4 border border-neutral-700">
                <div className="flex items-center justify-center gap-2 mb-3 text-amber-400">
                  <Trophy size={20} />
                  <h2 className="font-bold">로컬 랭킹 Top 5</h2>
                </div>
                <ul className="space-y-2">
                  {highScores.slice(0, 5).map((entry, i) => (
                    <li key={i} className="flex justify-between items-center text-sm">
                      <span className="flex items-center gap-2">
                        <span className={`font-bold ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-700' : 'text-neutral-400'}`}>
                          {i + 1}위
                        </span>
                        <span className="text-white truncate max-w-[100px]">{entry.name}</span>
                      </span>
                      <span className="font-mono text-amber-400">{entry.score.toFixed(2)}초</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {gameState === 'QUIZ' && (
          <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center p-6 text-center z-10 backdrop-blur-sm">
            <div className="bg-neutral-800 border-2 border-amber-500 rounded-2xl p-8 w-full max-w-sm shadow-2xl transform transition-all">
              <div className="flex justify-center mb-4">
                <div className="bg-amber-500 p-3 rounded-full text-black">
                  <Umbrella size={32} />
                </div>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">돌발 수학 퀴즈!</h2>
              <p className="text-amber-400 mb-4 text-sm">정답을 맞히면 5초간 무적 우산을 획득합니다!</p>
              
              <div className="text-red-400 font-bold text-xl mb-4">
                남은 시간: {quizTimeLeft}초
              </div>
              
              <div className="text-5xl font-mono font-bold text-white mb-8 bg-neutral-900 py-4 rounded-xl border border-neutral-700">
                {quiz.question}
              </div>
              
              <form onSubmit={handleQuizSubmit} className="flex flex-col gap-4">
                <input
                  type="number"
                  autoFocus
                  value={quizInput}
                  onChange={e => setQuizInput(e.target.value)}
                  className="text-center text-3xl p-4 rounded-xl bg-white text-black font-bold focus:outline-none focus:ring-4 focus:ring-amber-500"
                  placeholder="정답 입력"
                />
                <button type="submit" className="bg-amber-500 hover:bg-amber-400 text-black font-bold py-4 rounded-xl text-xl transition-colors">
                  확인
                </button>
              </form>
            </div>
          </div>
        )}

        {gameState === 'GAMEOVER' && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-6 text-center">
            <h2 className="text-5xl font-black text-red-500 mb-4 drop-shadow-lg">게임 오버!</h2>
            <p className="text-2xl text-white mb-2">버틴 시간: <span className="text-amber-400 font-mono font-bold">{score.toFixed(2)}초</span></p>

            <div className="my-8 w-full max-w-xs bg-neutral-800 rounded-xl p-4 border border-neutral-700">
              <div className="flex items-center justify-center gap-2 mb-3 text-amber-400">
                <Trophy size={20} />
                <h3 className="font-bold">로컬 랭킹</h3>
              </div>
              <ul className="space-y-2">
                {highScores.slice(0, 5).map((entry, i) => (
                  <li key={i} className={`flex justify-between items-center text-sm p-1 rounded ${entry.score === score && entry.name === playerName.trim() ? 'bg-amber-500/20 border border-amber-500/50' : ''}`}>
                    <span className="flex items-center gap-2">
                      <span className={`font-bold ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-700' : 'text-neutral-400'}`}>
                        {i + 1}위
                      </span>
                      <span className="text-white truncate max-w-[100px]">{entry.name}</span>
                    </span>
                    <span className="font-mono text-amber-400">{entry.score.toFixed(2)}초</span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              onClick={startGame}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 px-8 rounded-full transition-transform hover:scale-105 active:scale-95 cursor-pointer"
            >
              <RotateCcw size={24} />
              다시 하기
            </button>
          </div>
        )}
      </div>
      <p className="mt-6 text-neutral-400 text-sm text-center bg-neutral-800 px-4 py-2 rounded-lg">
        💻 <strong>PC:</strong> 좌우 방향키로 이동 <br/>
        📱 <strong>모바일:</strong> 화면 좌/우 터치로 이동
      </p>
    </div>
  );
}
