import React, { useState } from 'react';
import { Users, Play, UserCircle } from 'lucide-react';
import { Player } from './types';
import { CHARACTERS } from './constants';

interface SetupScreenProps {
  onStartGame: (players: Player[]) => void;
}

export default function SetupScreen({ onStartGame }: SetupScreenProps) {
  const [playerCount, setPlayerCount] = useState<number>(2);
  const [setupPlayers, setSetupPlayers] = useState(
    Array.from({ length: 2 }).map((_, i) => ({
      name: `플레이어 ${i + 1}`,
      grade: 3,
      characterId: CHARACTERS[i].id,
    }))
  );

  const handlePlayerCountChange = (count: number) => {
    setPlayerCount(count);
    const newPlayers = Array.from({ length: count }).map((_, i) => {
      // Retain existing choices if they exist
      if (setupPlayers[i]) return setupPlayers[i];
      // Otherwise assign default
      return {
        name: `플레이어 ${i + 1}`,
        grade: 3,
        characterId: CHARACTERS[i % CHARACTERS.length].id,
      };
    });
    setSetupPlayers(newPlayers);
  };

  const updatePlayer = (index: number, field: string, value: any) => {
    const newPlayers = [...setupPlayers];
    newPlayers[index] = { ...newPlayers[index], [field]: value };
    setSetupPlayers(newPlayers);
  };

  const handleStart = () => {
    // Generate final players
    const finalPlayers: Player[] = setupPlayers.map((p, index) => {
      const char = CHARACTERS.find(c => c.id === p.characterId)!;
      return {
        id: index + 1,
        name: p.name,
        grade: p.grade,
        position: 0,
        money: 1500, // 시작 금액
        color: char.color,
        characterId: char.id,
      };
    });
    onStartGame(finalPlayers);
  };

  return (
    <div className="min-h-screen bg-blue-50 flex items-center justify-center p-4 py-12 font-sans relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 flex items-center justify-center opacity-10">
        <h1 className="text-[20rem] font-display font-black text-blue-500 whitespace-nowrap rotate-[-10deg]">MATHPOLY</h1>
      </div>

      <div className="max-w-4xl w-full bg-white/90 backdrop-blur-md rounded-[3rem] shadow-2xl border-4 border-white p-8 md:p-12 z-10">
        <div className="text-center mb-12">
          <h1 className="font-display text-5xl md:text-6xl text-blue-600 mb-4 drop-shadow-sm">매스폴리 준비하기</h1>
          <p className="text-xl text-slate-600 font-medium">참가할 인원과 캐릭터를 골라주세요!</p>
        </div>

        {/* Player Count Selection */}
        <div className="mb-12 bg-blue-100 rounded-3xl p-6">
          <h2 className="font-display text-2xl text-slate-800 mb-4 flex items-center gap-2 justify-center">
            <Users className="text-blue-500" /> 몇 명이서 하나요?
          </h2>
          <div className="flex flex-wrap justify-center gap-3">
            {[2, 3, 4, 5, 6, 7].map((num) => (
              <button
                key={num}
                onClick={() => handlePlayerCountChange(num)}
                className={`w-16 h-16 rounded-2xl font-display text-2xl transition transform active:scale-95 shadow-md ${
                  playerCount === num
                    ? 'bg-blue-600 text-white scale-110 shadow-lg'
                    : 'bg-white text-slate-600 hover:bg-blue-50'
                }`}
              >
                {num}명
              </button>
            ))}
          </div>
        </div>

        {/* Player Setup Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {setupPlayers.map((player, idx) => (
            <div key={idx} className="bg-white rounded-3xl p-6 shadow-sm border-2 border-slate-100 flex gap-6 items-center">
              {/* Character Icon Preview */}
              <div className={`w-24 h-24 rounded-full flex items-center justify-center text-4xl shrink-0 shadow-inner ${CHARACTERS.find(c => c.id === player.characterId)?.color || 'bg-slate-200'}`}>
                {CHARACTERS.find(c => c.id === player.characterId)?.emoji}
              </div>

              <div className="flex-1 space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-500 mb-1">이름</label>
                  <input
                    type="text"
                    value={player.name}
                    onChange={(e) => updatePlayer(idx, 'name', e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border-2 border-slate-200 rounded-xl font-bold text-lg focus:outline-none focus:border-blue-400 focus:bg-white transition"
                  />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-sm font-bold text-slate-500 mb-1">학년</label>
                    <select
                      value={player.grade}
                      onChange={(e) => updatePlayer(idx, 'grade', parseInt(e.target.value))}
                      className="w-full px-4 py-2 bg-slate-50 border-2 border-slate-200 rounded-xl font-bold focus:outline-none focus:border-blue-400 transition"
                    >
                      {[1, 2, 3, 4, 5, 6].map(g => (
                        <option key={g} value={g}>{g}학년</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-bold text-slate-500 mb-1">캐릭터</label>
                    <select
                      value={player.characterId}
                      onChange={(e) => updatePlayer(idx, 'characterId', parseInt(e.target.value))}
                      className="w-full px-4 py-2 bg-slate-50 border-2 border-slate-200 rounded-xl font-bold focus:outline-none focus:border-blue-400 transition"
                    >
                      {CHARACTERS.map(c => (
                        <option key={c.id} value={c.id}>{c.name} {c.emoji}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-center flex-col items-center">
          <button
            onClick={handleStart}
            className="group px-12 py-5 bg-gradient-to-br from-yellow-400 to-orange-500 hover:from-yellow-300 hover:to-orange-400 text-white font-display text-3xl rounded-full shadow-xl shadow-orange-200 transform transition active:scale-95 flex items-center gap-4"
          >
            게임 시작하기! <Play className="group-hover:translate-x-1 transition" size={32} fill="currentColor" />
          </button>
          <p className="mt-4 text-slate-400 font-medium text-sm">모든 플레이어가 준비되었나요?</p>
        </div>
      </div>
    </div>
  );
}
