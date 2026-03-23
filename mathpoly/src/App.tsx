import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, Coins, Map, HelpCircle, AlertTriangle, Play, X, Check, ScrollText, Lock } from 'lucide-react';
import { Player, MathProblemResponse, Difficulty } from './types';
import { BOARD_SPACES, getGridPosition } from './constants';
import { generateMathEvent } from './lib/gemini';

const DICE_ICONS = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];

export default function App() {
  const [players, setPlayers] = useState<Player[]>([
    { id: 1, name: '지우 (3학년)', grade: 3, position: 0, money: 1500, color: 'bg-red-500' },
    { id: 2, name: '민수 (5학년)', grade: 5, position: 0, money: 1500, color: 'bg-blue-500' },
  ]);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [diceValue, setDiceValue] = useState<number | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  
  // Game Logs
  const [logs, setLogs] = useState<{id: number, text: string, type: 'info'|'success'|'warning'|'danger'}[]>([
    { id: 0, text: '매스폴리 게임이 시작되었습니다!', type: 'info' }
  ]);
  const logCounter = useRef(1);

  // Event State
  const [currentEvent, setCurrentEvent] = useState<MathProblemResponse | null>(null);
  const [isLoadingEvent, setIsLoadingEvent] = useState(false);
  const [showTablet, setShowTablet] = useState(false);
  
  // Problem Solving State
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty | null>(null);
  const [userAnswer, setUserAnswer] = useState('');
  const [jailAnswers, setJailAnswers] = useState<string[]>(['', '', '']);
  const [feedback, setFeedback] = useState<{ isCorrect: boolean; message: string; reward?: string } | null>(null);

  const currentPlayer = players[currentPlayerIndex];
  const currentSpace = BOARD_SPACES[currentPlayer.position];

  const addLog = (text: string, type: 'info'|'success'|'warning'|'danger' = 'info') => {
    setLogs(prev => [{ id: logCounter.current++, text, type }, ...prev].slice(0, 5));
  };

  const rollDice = async () => {
    if (isRolling || showTablet) return;
    
    // Check if player is in jail
    if (currentPlayer.isJailed) {
      addLog(`${currentPlayer.name}님은 수학 감옥에 있습니다! 탈출 미션을 시작합니다.`, 'warning');
      setIsLoadingEvent(true);
      setShowTablet(true);
      const eventData = await generateMathEvent(currentPlayer.grade, 'math_jail');
      setCurrentEvent(eventData);
      setIsLoadingEvent(false);
      return;
    }

    setIsRolling(true);
    setFeedback(null);
    setSelectedDifficulty(null);
    setUserAnswer('');
    setJailAnswers(['', '', '']);
    
    // Simulate roll animation
    let finalRoll = 1;
    for (let i = 0; i < 10; i++) {
      finalRoll = Math.floor(Math.random() * 6) + 1;
      setDiceValue(finalRoll);
      await new Promise(res => setTimeout(res, 50));
    }
    
    setIsRolling(false);
    addLog(`${currentPlayer.name}님이 주사위 ${finalRoll}을(를) 굴렸습니다.`, 'info');
    movePlayer(finalRoll);
  };

  const movePlayer = async (spaces: number) => {
    const newPosition = (currentPlayer.position + spaces) % 20;
    
    // Update position
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex] = { ...currentPlayer, position: newPosition };
    
    // Pass GO bonus
    if (newPosition < currentPlayer.position) {
      newPlayers[currentPlayerIndex].money += 300;
      addLog(`${currentPlayer.name}님이 출발점을 지나 월급 300원을 받았습니다!`, 'success');
    }
    
    setPlayers(newPlayers);
    
    // Trigger space event
    const space = BOARD_SPACES[newPosition];
    await handleSpaceEvent(space, newPlayers[currentPlayerIndex]);
  };

  const handleSpaceEvent = async (space: typeof BOARD_SPACES[0], player: Player) => {
    if (space.type === 'start') {
      addLog('출발점에 도착했습니다. 편안히 쉬어갑니다.', 'info');
      nextTurn();
      return;
    }

    if (space.type === 'jail') {
      addLog(`${player.name}님이 수학 감옥에 갇혔습니다! 다음 턴에 문제를 풀어야 탈출합니다.`, 'danger');
      const newPlayers = [...players];
      newPlayers[currentPlayerIndex].isJailed = true;
      setPlayers(newPlayers);
      nextTurn();
      return;
    }

    if (space.type === 'land') {
      if (space.ownerId) {
        if (space.ownerId === player.id) {
          addLog(`${space.name}은(는) 내 땅입니다. 편안히 쉬어갑니다.`, 'info');
          nextTurn();
          return;
        } else {
          // Pay Rent
          const owner = players.find(p => p.id === space.ownerId);
          if (owner && space.rent) {
            addLog(`${owner.name}님의 땅에 도착했습니다! 통행료 ${space.rent}원을 지불합니다.`, 'danger');
            const newPlayers = [...players];
            newPlayers[currentPlayerIndex].money -= space.rent;
            const ownerIndex = newPlayers.findIndex(p => p.id === owner.id);
            newPlayers[ownerIndex].money += space.rent;
            setPlayers(newPlayers);
          }
          nextTurn();
          return;
        }
      }
    }

    // Unowned Land, Chance, or Challenge
    setIsLoadingEvent(true);
    setShowTablet(true);
    
    let eventType = 'land_purchase';
    if (space.type === 'chance') eventType = 'chance_card';
    if (space.type === 'challenge') eventType = 'challenge';

    const eventData = await generateMathEvent(player.grade, eventType);
    setCurrentEvent(eventData);
    setIsLoadingEvent(false);
  };

  const submitAnswer = () => {
    if (!currentEvent || currentEvent.type !== 'math_problem' || !selectedDifficulty) return;
    
    const problemData = currentEvent.data?.[selectedDifficulty];
    if (!problemData) return;

    // Simple string comparison for prototype
    const isCorrect = userAnswer.trim().replace(/\s+/g, '') === problemData.answer.trim().replace(/\s+/g, '');
    
    if (isCorrect) {
      let rewardMsg = '정답입니다!';
      
      // Buy land logic with difficulty perks
      if (currentSpace.type === 'land' && !currentSpace.ownerId && currentSpace.price) {
        const newPlayers = [...players];
        let cost = currentSpace.price;
        
        if (selectedDifficulty === 'mid') {
          cost = Math.floor(cost * 0.5);
          rewardMsg = `정답! 중 난이도 혜택으로 반값(${cost}원)에 땅을 샀습니다!`;
        } else if (selectedDifficulty === 'high') {
          cost = 0;
          rewardMsg = `대단해요! 상 난이도 혜택으로 땅을 무료로 획득했습니다!`;
        } else {
          rewardMsg = `정답! ${cost}원을 지불하고 땅을 샀습니다.`;
        }

        newPlayers[currentPlayerIndex].money -= cost;
        setPlayers(newPlayers);
        currentSpace.ownerId = currentPlayer.id;
        addLog(`${currentPlayer.name}님이 ${currentSpace.name}을(를) 차지했습니다!`, 'success');
      } else if (currentSpace.type === 'challenge') {
        const reward = selectedDifficulty === 'high' ? 300 : selectedDifficulty === 'mid' ? 200 : 100;
        const newPlayers = [...players];
        newPlayers[currentPlayerIndex].money += reward;
        setPlayers(newPlayers);
        rewardMsg = `도전 성공! 보상으로 ${reward}원을 받았습니다!`;
        addLog(`${currentPlayer.name}님이 도전에 성공하여 ${reward}원을 받았습니다.`, 'success');
      }

      setFeedback({ isCorrect: true, message: rewardMsg });
    } else {
      setFeedback({ isCorrect: false, message: `틀렸습니다. 정답은 ${problemData.answer} 입니다.` });
      addLog(`${currentPlayer.name}님이 문제 풀이에 실패했습니다.`, 'warning');
    }
  };

  const submitJailAnswers = () => {
    if (!currentEvent || currentEvent.type !== 'jail_problem') return;
    
    const answers = currentEvent.jail_answers || [];
    let allCorrect = true;
    
    for (let i = 0; i < answers.length; i++) {
      if (jailAnswers[i].trim().replace(/\s+/g, '') !== answers[i].trim().replace(/\s+/g, '')) {
        allCorrect = false;
        break;
      }
    }

    if (allCorrect) {
      setFeedback({ isCorrect: true, message: '모든 문제를 맞혔습니다! 감옥에서 탈출합니다!' });
      const newPlayers = [...players];
      newPlayers[currentPlayerIndex].isJailed = false;
      setPlayers(newPlayers);
      addLog(`${currentPlayer.name}님이 감옥 탈출에 성공했습니다!`, 'success');
    } else {
      setFeedback({ isCorrect: false, message: '틀린 문제가 있습니다. 다음 턴에 다시 도전하세요!' });
      addLog(`${currentPlayer.name}님이 감옥 탈출에 실패했습니다.`, 'danger');
    }
  };

  const handleChanceAcknowledge = () => {
    const effect = currentEvent?.chance_effect || '';
    const newPlayers = [...players];
    
    if (effect.includes('GET_MONEY') || effect.includes('MULTIPLY')) {
      newPlayers[currentPlayerIndex].money += 300;
      addLog(`${currentPlayer.name}님이 찬스 카드로 300원을 얻었습니다!`, 'success');
    } else if (effect.includes('LOSE_MONEY')) {
      newPlayers[currentPlayerIndex].money -= 200;
      addLog(`${currentPlayer.name}님이 찬스 카드로 200원을 잃었습니다.`, 'danger');
    } else if (effect.includes('ESCAPE_JAIL')) {
      newPlayers[currentPlayerIndex].isJailed = false;
      addLog(`${currentPlayer.name}님이 감옥 탈출권을 얻었습니다!`, 'success');
    } else {
      newPlayers[currentPlayerIndex].money += 100; // Default positive effect
      addLog(`${currentPlayer.name}님이 찬스 카드로 100원을 얻었습니다!`, 'success');
    }
    
    setPlayers(newPlayers);
    closeTabletAndNextTurn();
  };

  const closeTabletAndNextTurn = () => {
    setShowTablet(false);
    setCurrentEvent(null);
    setFeedback(null);
    nextTurn();
  };

  const nextTurn = () => {
    setCurrentPlayerIndex((prev) => (prev + 1) % players.length);
    setDiceValue(null);
  };

  const DiceIcon = diceValue ? DICE_ICONS[diceValue - 1] : Dice6;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 font-sans">
      <div className="max-w-[90rem] w-full flex flex-col xl:flex-row gap-8 items-center xl:items-start">
        
        {/* Main Board Area */}
        <div className="relative w-full max-w-3xl aspect-square bg-blue-100 rounded-3xl shadow-2xl border-8 border-blue-300 p-2 overflow-hidden shrink-0">
          {/* Board Grid */}
          <div className="w-full h-full grid grid-cols-6 grid-rows-6 gap-1">
            {BOARD_SPACES.map((space) => {
              const pos = getGridPosition(space.id);
              const isCorner = space.id % 5 === 0;
              return (
                <div
                  key={space.id}
                  className={`relative bg-white rounded-lg shadow-sm border-2 border-blue-200 flex flex-col items-center justify-center text-center p-1 overflow-hidden ${
                    isCorner ? 'bg-blue-50' : ''
                  }`}
                  style={{ gridColumn: pos.col, gridRow: pos.row }}
                >
                  {space.colorGroup && (
                    <div className={`absolute top-0 left-0 right-0 h-1/4 ${space.colorGroup} opacity-80`} />
                  )}
                  <span className="font-display text-sm md:text-base z-10 mt-2 leading-tight">
                    {space.name}
                  </span>
                  {space.price && (
                    <span className="text-xs font-bold text-gray-600 z-10">₩{space.price}</span>
                  )}
                  {space.ownerId && (
                    <div className={`absolute bottom-1 w-full h-2 ${players.find(p => p.id === space.ownerId)?.color} opacity-50`} />
                  )}
                </div>
              );
            })}

            {/* Center Area */}
            <div className="col-start-2 col-end-6 row-start-2 row-end-6 bg-blue-200/50 rounded-2xl m-2 flex flex-col items-center justify-center p-6 relative">
              <div className="text-center mb-8">
                <h1 className="font-display text-5xl md:text-7xl text-white drop-shadow-lg tracking-wider" style={{ WebkitTextStroke: '2px #2563eb' }}>
                  MATHPOLY
                </h1>
                <h2 className="font-display text-2xl md:text-4xl text-yellow-400 drop-shadow-md mt-2" style={{ WebkitTextStroke: '1px #b45309' }}>
                  수학 땅따먹기
                </h2>
              </div>

              {/* Dice & Controls */}
              <div className="flex flex-col items-center gap-4 bg-white/90 p-6 rounded-2xl shadow-xl backdrop-blur-sm border-2 border-white">
                <div className="flex items-center gap-4">
                  <motion.div
                    animate={isRolling ? { rotate: 360, scale: [1, 1.2, 1] } : {}}
                    transition={{ duration: 0.5, repeat: isRolling ? Infinity : 0 }}
                    className="text-blue-600"
                  >
                    <DiceIcon size={64} strokeWidth={1.5} />
                  </motion.div>
                </div>
                
                <button
                  onClick={rollDice}
                  disabled={isRolling || showTablet}
                  className="px-8 py-3 bg-gradient-to-b from-yellow-400 to-orange-500 hover:from-yellow-300 hover:to-orange-400 text-white font-display text-2xl rounded-full shadow-lg transform transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {currentPlayer.isJailed ? <Lock size={24} /> : <Play size={24} fill="currentColor" />}
                  {currentPlayer.isJailed ? '탈출 도전!' : '주사위 굴리기'}
                </button>

                <div className="text-center mt-2">
                  <p className="text-sm text-gray-500 font-bold">현재 턴</p>
                  <p className={`font-display text-2xl ${currentPlayer.id === 1 ? 'text-red-600' : 'text-blue-600'}`}>
                    {currentPlayer.name}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Player Tokens */}
          {players.map((player) => {
            const pos = getGridPosition(player.position);
            const left = `${((pos.col - 1) / 6) * 100 + (player.id === 1 ? 2 : 8)}%`;
            const top = `${((pos.row - 1) / 6) * 100 + (player.id === 1 ? 2 : 8)}%`;
            
            return (
              <motion.div
                key={player.id}
                initial={false}
                animate={{ left, top }}
                transition={{ type: 'spring', stiffness: 100, damping: 15 }}
                className={`absolute w-8 h-8 md:w-10 md:h-10 rounded-full border-4 border-white shadow-lg z-20 flex items-center justify-center ${player.color} ${player.isJailed ? 'opacity-50 grayscale' : ''}`}
              >
                <span className="text-white font-bold text-xs">{player.id}</span>
                {player.isJailed && (
                  <div className="absolute -top-2 -right-2 bg-slate-800 text-white rounded-full p-1">
                    <Lock size={12} />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Side Panel */}
        <div className="w-full xl:w-96 flex flex-col gap-6 shrink-0">
          
          {/* Player Stats */}
          <div className="bg-white rounded-3xl shadow-xl p-6 border-4 border-slate-200">
            <h3 className="font-display text-2xl text-slate-800 mb-4 flex items-center gap-2">
              <Map className="text-blue-500" /> 게임 현황
            </h3>
            <div className="space-y-4">
              {players.map(p => (
                <div key={p.id} className={`p-4 rounded-xl border-2 transition-colors ${p.id === currentPlayer.id ? 'border-blue-400 bg-blue-50' : 'border-slate-100'}`}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-lg flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full ${p.color}`} />
                      {p.name}
                      {p.isJailed && <span className="text-xs bg-slate-800 text-white px-2 py-1 rounded-md">감옥</span>}
                    </span>
                    <span className="font-display text-slate-500">{p.grade}학년</span>
                  </div>
                  <div className="flex items-center gap-2 text-amber-600 font-bold text-xl">
                    <Coins size={20} /> ₩{p.money.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Game Logs */}
          <div className="bg-white rounded-3xl shadow-xl p-6 border-4 border-slate-200 flex-1 min-h-[200px] flex flex-col">
            <h3 className="font-display text-xl text-slate-800 mb-4 flex items-center gap-2">
              <ScrollText className="text-amber-500" /> 게임 기록
            </h3>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
              <AnimatePresence initial={false}>
                {logs.map((log) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-3 rounded-lg text-sm font-medium border-l-4 ${
                      log.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                      log.type === 'danger' ? 'bg-red-50 border-red-500 text-red-800' :
                      log.type === 'warning' ? 'bg-yellow-50 border-yellow-500 text-yellow-800' :
                      'bg-slate-50 border-blue-500 text-slate-700'
                    }`}
                  >
                    {log.text}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* The Tablet Modal (Absolute positioning over everything on mobile, inline on desktop if space permits) */}
          <AnimatePresence>
            {showTablet && (
              <motion.div
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-4 z-50 md:relative md:inset-auto bg-slate-800 p-3 rounded-[2rem] shadow-2xl border-b-8 border-slate-900 flex flex-col"
              >
                {/* Tablet Screen */}
                <div className="bg-slate-50 rounded-2xl flex-1 md:h-[500px] overflow-hidden flex flex-col relative">
                  {/* Header */}
                  <div className="bg-blue-500 text-white p-3 flex justify-between items-center shadow-md z-10">
                    <span className="font-display text-lg">{currentPlayer.grade}학년 미션</span>
                    <span className="font-bold bg-blue-700 px-3 py-1 rounded-full text-sm">
                      {currentSpace.name}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-5 overflow-y-auto">
                    {isLoadingEvent ? (
                      <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                        <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
                          <HelpCircle size={48} className="text-blue-400" />
                        </motion.div>
                        <p className="font-display text-xl animate-pulse">문제를 생성하는 중...</p>
                      </div>
                    ) : currentEvent ? (
                      <div className="space-y-6">
                        {currentEvent.type === 'math_problem' && (
                          <>
                            <p className="text-center font-bold text-slate-700 mb-4">
                              {currentSpace.type === 'challenge' ? '도전 문제를 풀고 상금을 받으세요!' : '문제를 풀고 땅을 차지하세요!'}
                            </p>
                            
                            {/* Difficulty Selector */}
                            {!selectedDifficulty && !feedback && (
                              <div className="space-y-3">
                                <button onClick={() => setSelectedDifficulty('low')} className="w-full p-4 bg-green-100 hover:bg-green-200 border-2 border-green-400 rounded-xl flex items-start gap-4 transition text-left">
                                  <span className="bg-green-500 text-white font-display px-3 py-1 rounded-lg">하</span>
                                  <span className="font-bold text-slate-700 mt-1">기본 연산 <span className="text-green-700">(정가 구매)</span></span>
                                </button>
                                <button onClick={() => setSelectedDifficulty('mid')} className="w-full p-4 bg-yellow-100 hover:bg-yellow-200 border-2 border-yellow-400 rounded-xl flex items-start gap-4 transition text-left">
                                  <span className="bg-yellow-500 text-white font-display px-3 py-1 rounded-lg">중</span>
                                  <span className="font-bold text-slate-700 mt-1">응용 문제 <span className="text-yellow-700">(반값 할인!)</span></span>
                                </button>
                                <button onClick={() => setSelectedDifficulty('high')} className="w-full p-4 bg-red-100 hover:bg-red-200 border-2 border-red-400 rounded-xl flex items-start gap-4 transition text-left">
                                  <span className="bg-red-500 text-white font-display px-3 py-1 rounded-lg">상</span>
                                  <span className="font-bold text-slate-700 mt-1">심화 문제 <span className="text-red-700">(무료 획득!!)</span></span>
                                </button>
                              </div>
                            )}

                            {/* Problem Display */}
                            {selectedDifficulty && (
                              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
                                <div className="bg-white p-6 rounded-xl shadow-sm border-2 border-blue-100 text-lg font-medium text-slate-800">
                                  {currentEvent.data?.[selectedDifficulty]?.question}
                                </div>
                                
                                {!feedback ? (
                                  <div className="flex gap-2">
                                    <input
                                      type="text"
                                      value={userAnswer}
                                      onChange={(e) => setUserAnswer(e.target.value)}
                                      placeholder="정답을 입력하세요"
                                      className="flex-1 px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none text-lg"
                                      onKeyDown={(e) => e.key === 'Enter' && submitAnswer()}
                                    />
                                    <button
                                      onClick={submitAnswer}
                                      className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition"
                                    >
                                      확인
                                    </button>
                                  </div>
                                ) : (
                                  <div className={`p-6 rounded-xl border-2 ${feedback.isCorrect ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                    <div className="flex items-center gap-3 font-bold text-xl mb-2">
                                      {feedback.isCorrect ? <Check className="text-green-600" /> : <X className="text-red-600" />}
                                      {feedback.message}
                                    </div>
                                    {currentEvent.data?.[selectedDifficulty]?.explanation && (
                                      <div className="mt-4 pt-4 border-t border-current/20 text-sm opacity-90">
                                        <span className="font-bold block mb-1">해설:</span>
                                        {currentEvent.data[selectedDifficulty].explanation}
                                      </div>
                                    )}
                                    <button
                                      onClick={closeTabletAndNextTurn}
                                      className="mt-6 w-full py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-700 transition"
                                    >
                                      턴 종료
                                    </button>
                                  </div>
                                )}
                              </motion.div>
                            )}
                          </>
                        )}

                        {currentEvent.type === 'chance_card' && (
                          <div className="text-center space-y-6 py-8">
                            <div className="w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6">
                              <AlertTriangle size={48} className="text-yellow-500" />
                            </div>
                            <h4 className="font-display text-3xl text-slate-800">찬스 카드!</h4>
                            <p className="text-xl text-slate-600 font-medium px-4">
                              {currentEvent.chance_text || '행운이 찾아왔습니다!'}
                            </p>
                            <button
                              onClick={handleChanceAcknowledge}
                              className="w-full py-4 bg-yellow-500 hover:bg-yellow-600 text-white font-bold text-lg rounded-xl transition mt-8"
                            >
                              확인
                            </button>
                          </div>
                        )}

                        {currentEvent.type === 'jail_problem' && (
                          <div className="space-y-6">
                            <div className="bg-slate-800 text-white p-4 rounded-xl text-center">
                              <h4 className="font-display text-2xl text-red-400 mb-2">수학 감옥 탈출 미션!</h4>
                              <p>다음 3문제를 모두 맞혀야 탈출할 수 있습니다.</p>
                            </div>
                            
                            {!feedback ? (
                              <>
                                <div className="space-y-3">
                                  {currentEvent.jail_problems?.map((prob, idx) => (
                                    <div key={idx} className="bg-white p-4 rounded-xl border-2 border-slate-200 flex items-center justify-between gap-4">
                                      <span className="font-bold text-lg text-slate-800">{prob}</span>
                                      <input 
                                        type="text" 
                                        value={jailAnswers[idx]}
                                        onChange={(e) => {
                                          const newAns = [...jailAnswers];
                                          newAns[idx] = e.target.value;
                                          setJailAnswers(newAns);
                                        }}
                                        className="w-24 px-3 py-2 border-2 border-slate-200 rounded-lg text-center text-slate-800 font-bold focus:border-blue-500 outline-none" 
                                        placeholder="?" 
                                      />
                                    </div>
                                  ))}
                                </div>
                                <button
                                  onClick={submitJailAnswers}
                                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg rounded-xl transition"
                                >
                                  제출하기
                                </button>
                              </>
                            ) : (
                              <div className={`p-6 rounded-xl border-2 ${feedback.isCorrect ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                <div className="flex items-center gap-3 font-bold text-xl mb-2">
                                  {feedback.isCorrect ? <Check className="text-green-600" /> : <X className="text-red-600" />}
                                  {feedback.message}
                                </div>
                                <button
                                  onClick={closeTabletAndNextTurn}
                                  className="mt-6 w-full py-3 bg-slate-800 text-white font-bold rounded-xl hover:bg-slate-700 transition"
                                >
                                  턴 종료
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                  
                  {/* Tablet Home Button */}
                  <div className="h-12 bg-slate-100 border-t border-slate-200 flex items-center justify-center shrink-0">
                    <div className="w-12 h-1 rounded-full bg-slate-300" />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
