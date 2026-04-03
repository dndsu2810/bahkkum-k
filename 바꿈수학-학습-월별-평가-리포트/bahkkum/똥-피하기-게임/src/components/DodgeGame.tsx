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
  const poopsRef = useRef<{ x: number; y: number; vy: number }[]>([]);
  const lastPoopZoneRef = useRef(-1);
  const timeRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const requestRef = useRef<number | null>(null);
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const difficultyRef = useRef(1);
  const levelRef = useRef(1);
  const levelUpTimerRef = useRef(0);
  const umbrellaTimerRef = useRef(0);
  const shakeRef = useRef(0); // For screen shake

  const [lastQuizTime, setLastQuizTime] = useState(0);
  const [nextLevelTime, setNextLevelTime] = useState(5);
  const [nextPoopTime, setNextPoopTime] = useState(0);

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
    setHighScores(prev => {
      const updated = [...prev, newEntry].sort((a, b) => b.score - a.score).slice(0, 10);
      localStorage.setItem('dodge_poop_scores_time', JSON.stringify(updated));
      return updated;
    });
  };

  const startGame = () => {
    playerRef.current = { x: CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, y: CANVAS_HEIGHT - 20 - PLAYER_SIZE, vx: 0 };
    poopsRef.current = [];
    timeRef.current = 0;
    difficultyRef.current = 1;
    levelRef.current = 1;
    levelUpTimerRef.current = 0;
    umbrellaTimerRef.current = 0;
    shakeRef.current = 0;
    setLastQuizTime(0);
    setNextLevelTime(5);
    setNextPoopTime(0);
    setScore(0);
    lastTimeRef.current = performance.now();
    setGameState('PLAYING');
  };

  const gameOver = () => {
    setGameState('GAMEOVER');
    setScore(timeRef.current);
    saveScore(timeRef.current);
    shakeRef.current = 20; // Big shake on death
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
      umbrellaTimerRef.current = 5; // 5 seconds
    }
    lastTimeRef.current = performance.now();
    setGameState('PLAYING');
  };

  const update = useCallback((dt: number) => {
    if (gameState !== 'PLAYING') return;

    timeRef.current += dt;
    
    // Smoothly decrease shake
    if (shakeRef.current > 0) {
      shakeRef.current -= dt * 40;
      if (shakeRef.current < 0) shakeRef.current = 0;
    }

    const player = playerRef.current;
    const poops = poopsRef.current;

    if (umbrellaTimerRef.current > 0) {
      umbrellaTimerRef.current -= dt;
    }

    if (keysRef.current['ArrowLeft']) player.vx = -420; // 7 * 60
    else if (keysRef.current['ArrowRight']) player.vx = 420;
    else player.vx = 0;

    player.x += player.vx * dt;

    if (player.x < 0) player.x = 0;
    if (player.x > CANVAS_WIDTH - PLAYER_SIZE) player.x = CANVAS_WIDTH - PLAYER_SIZE;

    // Level up every 5 seconds
    if (timeRef.current >= nextLevelTime) {
      difficultyRef.current += 0.3;
      levelRef.current += 1;
      levelUpTimerRef.current = 1.5; // 1.5 seconds animation
      setNextLevelTime(prev => prev + 5);
    }

    if (levelUpTimerRef.current > 0) {
      levelUpTimerRef.current -= dt;
    }

    // Quiz every 20 seconds
    if (timeRef.current - lastQuizTime >= 20) {
      setLastQuizTime(timeRef.current);
      generateQuiz(levelRef.current);
      return;
    }

    // Spawning logic (time-based)
    if (timeRef.current >= nextPoopTime) {
      const spawnInterval = Math.max(0.1, 0.5 - (difficultyRef.current * 0.05));
      setNextPoopTime(timeRef.current + spawnInterval);

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
        vy: (180 + Math.random() * 120) * difficultyRef.current // 3~5 * 60
      });
    }

    for (let i = poops.length - 1; i >= 0; i--) {
      const p = poops[i];
      p.y += p.vy * dt;

      const hitboxShrink = 8;
      if (
        player.x + hitboxShrink < p.x + POOP_SIZE - hitboxShrink &&
        player.x + PLAYER_SIZE - hitboxShrink > p.x + hitboxShrink &&
        player.y + hitboxShrink < p.y + POOP_SIZE - hitboxShrink &&
        player.y + PLAYER_SIZE - hitboxShrink > p.y + hitboxShrink
      ) {
        if (umbrellaTimerRef.current > 0) {
          poops.splice(i, 1);
          shakeRef.current = 5; // Small shake on block
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
  }, [gameState, nextLevelTime, nextPoopTime, lastQuizTime]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    
    // Apply Shake
    if (shakeRef.current > 0) {
      const dx = (Math.random() - 0.5) * shakeRef.current;
      const dy = (Math.random() - 0.5) * shakeRef.current;
      ctx.translate(dx, dy);
    }

    // Draw Background (Sky Gradient)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    skyGrad.addColorStop(0, '#4A90E2');
    skyGrad.addColorStop(1, '#87CEEB');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw Ground
    ctx.fillStyle = '#6D4C41';
    ctx.fillRect(0, CANVAS_HEIGHT - 20, CANVAS_WIDTH, 20);

    if (gameState === 'PLAYING' || gameState === 'QUIZ') {
      const player = playerRef.current;
      
      // Draw Player Shadow
      ctx.beginPath();
      ctx.ellipse(player.x + PLAYER_SIZE / 2, CANVAS_HEIGHT - 15, PLAYER_SIZE / 2, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fill();

      // Draw Player
      ctx.font = `${PLAYER_SIZE}px Arial`;
      ctx.fillText('🏃', player.x, player.y + PLAYER_SIZE - 5);

      // Draw Player Name
      ctx.fillStyle = 'white';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'black';
      ctx.shadowBlur = 4;
      ctx.fillText(playerName.trim() || 'Player', player.x + PLAYER_SIZE / 2, player.y - 12);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';

      // Draw Umbrella if active
      if (umbrellaTimerRef.current > 0) {
        ctx.font = `${PLAYER_SIZE}px Arial`;
        ctx.globalAlpha = 0.8 + Math.sin(timeRef.current * 15) * 0.2; // Pulsing
        ctx.fillText('☂️', player.x, player.y - 15);
        
        ctx.beginPath();
        ctx.arc(player.x + PLAYER_SIZE / 2, player.y + PLAYER_SIZE / 2, PLAYER_SIZE * 0.8, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 255, 255, ${Math.min(1, umbrellaTimerRef.current)})`;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      // Draw Poops
      ctx.font = `${POOP_SIZE}px Arial`;
      poopsRef.current.forEach(p => {
        ctx.fillText('💩', p.x, p.y + POOP_SIZE - 5);
      });

      // Draw UI (Time & Level)
      ctx.fillStyle = 'white';
      ctx.font = 'bold 22px Arial';
      ctx.shadowColor = 'black';
      ctx.shadowBlur = 4;
      ctx.fillText(`⏱️ ${timeRef.current.toFixed(2)}s`, 20, 40);

      ctx.textAlign = 'right';
      ctx.fillText(`Lv. ${levelRef.current}`, CANVAS_WIDTH - 20, 40);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';

      // Draw Level Up Text
      if (levelUpTimerRef.current > 0) {
        ctx.save();
        const alpha = Math.min(1, levelUpTimerRef.current);
        ctx.fillStyle = `rgba(255, 215, 0, ${alpha})`;
        ctx.font = 'bold 60px Arial';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'black';
        ctx.shadowBlur = 15;
        ctx.fillText('LEVEL UP!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - (1.5 - levelUpTimerRef.current) * 100);
        ctx.restore();
      }
    } else {
      ctx.font = `${PLAYER_SIZE}px Arial`;
      ctx.fillText('🏃', CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, CANVAS_HEIGHT - 20 - PLAYER_SIZE + PLAYER_SIZE - 5);
    }
    
    ctx.restore();
  }, [gameState, playerName]);

  const loop = useCallback(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTimeRef.current) / 1000); // Caps dt to avoid jumps
    lastTimeRef.current = now;

    update(dt);
    draw();
    
    if (gameState === 'PLAYING' || gameState === 'QUIZ') {
      requestRef.current = requestAnimationFrame(loop);
    }
  }, [update, draw, gameState]);

  useEffect(() => {
    if (gameState === 'PLAYING' || gameState === 'QUIZ') {
      lastTimeRef.current = performance.now(); // Prevents jumping when starting
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white p-4 font-sans selection:bg-amber-500/30">
      <div className="relative bg-slate-900 ring-8 ring-slate-800 rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] w-full max-w-[500px] aspect-[5/7] touch-none">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block w-full h-full cursor-none"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        />

        {gameState === 'MENU' && (
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500">
            <div className="bg-amber-500/10 p-2 rounded-full mb-4 ring-2 ring-amber-500/30">
              <span className="text-4xl animate-bounce inline-block">💩</span>
            </div>
            <h1 className="text-4xl font-black text-amber-400 mb-2 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">똥 피하기 챌린지</h1>
            <p className="text-slate-300 mb-8 max-w-[280px]">하늘에서 떨어지는 위기를 극복하고 최고의 생존자가 되어보세요!</p>

            <div className="mb-8 w-full max-w-xs group">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 text-left ml-1">나의 닉네임</label>
              <div className="relative">
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  className="w-full px-5 py-3 bg-slate-800 border-2 border-slate-700 rounded-xl focus:outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/20 text-white transition-all text-lg font-bold"
                  placeholder="이름을 입력하세요"
                  maxLength={10}
                />
              </div>
            </div>

            <button
              onClick={startGame}
              className="group relative flex items-center justify-center gap-3 bg-amber-500 hover:bg-amber-400 text-black font-black py-4 px-10 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-[0_4px_0_rgb(180,120,0)] active:shadow-none active:translate-y-1"
            >
              <Play size={24} fill="currentColor" />
              <span className="text-xl">게임 시작하기</span>
            </button>

            {highScores.length > 0 && (
              <div className="mt-10 w-full max-w-xs bg-slate-800/50 backdrop-blur-sm rounded-2xl p-5 border border-slate-700/50">
                <div className="flex items-center justify-center gap-2 mb-4 text-amber-400">
                  <Trophy size={18} />
                  <h2 className="text-sm font-bold tracking-widest uppercase">명예의 전당</h2>
                </div>
                <ul className="space-y-3">
                  {highScores.slice(0, 5).map((entry, i) => (
                    <li key={i} className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-black ${i === 0 ? 'bg-amber-500 text-black' : i === 1 ? 'bg-slate-300 text-black' : i === 2 ? 'bg-amber-700 text-white' : 'bg-slate-700 text-slate-400'}`}>
                          {i + 1}
                        </div>
                        <span className="text-sm font-medium text-slate-200 truncate max-w-[100px]">{entry.name}</span>
                      </div>
                      <span className="font-mono font-bold text-amber-500 text-sm">{entry.score.toFixed(2)}s</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {gameState === 'QUIZ' && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-lg flex flex-col items-center justify-center p-6 text-center z-10 animate-in zoom-in duration-300">
            <div className="bg-slate-800 border-2 border-amber-500 rounded-3xl p-8 w-full max-w-sm shadow-[0_0_40px_rgba(245,158,11,0.2)]">
              <div className="flex justify-center mb-6">
                <div className="bg-amber-500 p-4 rounded-3xl text-black shadow-xl animate-pulse">
                  <Umbrella size={40} />
                </div>
              </div>
              <h2 className="text-2xl font-black text-white mb-2">돌발 보너스 퀴즈!</h2>
              <p className="text-slate-400 mb-6 text-sm">정답을 맞히면 <span className="text-amber-400 font-bold">5초간 무적 우산</span>이 지급됩니다!</p>
              
              <div className="relative mb-6">
                <div className="text-amber-500 font-black text-lg mb-2 flex items-center justify-center gap-2">
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-ping"></span>
                  남은 시간: {quizTimeLeft}초
                </div>
                <div className="bg-slate-900 py-6 rounded-2xl border-2 border-slate-700 shadow-inner">
                  <span className="text-5xl font-mono font-black text-white">{quiz.question}</span>
                </div>
              </div>
              
              <form onSubmit={handleQuizSubmit} className="flex flex-col gap-4">
                <input
                  type="number"
                  autoFocus
                  value={quizInput}
                  onChange={e => setQuizInput(e.target.value)}
                  className="text-center text-4xl p-5 rounded-2xl bg-white text-black font-black focus:outline-none focus:ring-4 focus:ring-amber-500/50 placeholder:text-slate-200"
                  placeholder="?"
                />
                <button type="submit" className="bg-amber-500 hover:bg-amber-400 active:scale-95 text-black font-black py-4 rounded-2xl text-xl shadow-[0_4px_0_rgb(180,120,0)] active:shadow-none active:translate-y-1 transition-all">
                  정답 제출
                </button>
              </form>
            </div>
          </div>
        )}

        {gameState === 'GAMEOVER' && (
          <div className="absolute inset-0 bg-red-950/70 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-700">
            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mb-6 border-2 border-red-500/30">
              <span className="text-5xl">💀</span>
            </div>
            <h2 className="text-6xl font-black text-white mb-2 tracking-tighter drop-shadow-lg">GAME OVER</h2>
            <div className="bg-white/10 backdrop-blur-md px-6 py-3 rounded-2xl mb-8 border border-white/20">
               <span className="text-lg text-slate-300">최종 기록:</span>
               <span className="text-3xl text-amber-400 font-black font-mono ml-3">{score.toFixed(2)}초</span>
            </div>

            <div className="w-full max-w-xs bg-slate-900/80 rounded-2xl p-5 border border-slate-800 mb-8">
              <div className="flex items-center justify-center gap-2 mb-4 text-amber-400">
                <Trophy size={18} />
                <h3 className="text-sm font-bold uppercase tracking-widest">나의 순위</h3>
              </div>
              <ul className="space-y-3">
                {highScores.slice(0, 5).map((entry, i) => (
                  <li key={i} className={`flex justify-between items-center p-2 rounded-xl transition-colors ${entry.score === score && entry.name === playerName.trim() ? 'bg-amber-500/20 ring-1 ring-amber-500' : ''}`}>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-black w-5 ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-700' : 'text-slate-500'}`}>
                        {i + 1}
                      </span>
                      <span className="text-sm font-bold text-slate-200 truncate max-w-[100px]">{entry.name}</span>
                    </div>
                    <span className="font-mono font-black text-amber-500 text-sm">{entry.score.toFixed(2)}s</span>
                  </li>
                ))}
              </ul>
            </div>

            <button
              onClick={startGame}
              className="flex items-center gap-3 bg-white hover:bg-slate-100 text-slate-950 font-black py-4 px-10 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-[0_4px_0_rgb(200,200,200)] active:shadow-none active:translate-y-1"
            >
              <RotateCcw size={24} />
              <span className="text-xl">다시 도전하기</span>
            </button>
          </div>
        )}
      </div>
      <div className="mt-8 flex flex-col items-center gap-4">
        <div className="flex gap-2">
            <span className="px-3 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold text-slate-400">PC: 방향키</span>
            <span className="px-3 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs font-bold text-slate-400">모바일: 터치</span>
        </div>
        <p className="text-slate-500 text-[10px] uppercase tracking-[0.2em] font-bold">
          bahkkum • Dodge the Poop
        </p>
      </div>
    </div>
  );
}
