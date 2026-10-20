// 테트리스 대전 (jstris 방식, 마지막까지 살아남은 학생이 1위)
// 데이터 위치: tetris/rooms/{code}   (방 코드 4자리, 관리자만 만들 수 있음)
//   rooms/{code}   { name, created, game: { no, id('g1'…), seed, start, over? } }
//   lobby/{code}/{학번}            { n, t }   방에 들어와 있는 학생 (2초마다 갱신)
//   entries/{code}/{판 id}/{학번}  { n }      그 판에 참가한 학생 (시작 3초 뒤까지만 쓸 수 있음)
//   results/{code}/{판 id}/{학번}  { t, sent, lines, pieces, win?, stop?, dc? }  탈락/1위/강제 종료 기록 (한 번만)
//   boards/{code}/{학번}           { n, g, b(보이는 20줄), d, i }  썸네일용 보드
//   attacks/{code}/{학번}/{id}     { l(줄 수), g, f }  받을 공격
// 판 진행(블록 놓기, 공격)은 학생 브라우저끼리 주고받고, 방/판 시작·종료만 서버(여기)가 씁니다.

import { ApiError, fb, roomCode } from './firebase.js';

const COUNTDOWN_MS = 5000; // 시작 버튼 → 실제 시작까지
const ROOM_DATA = ['lobby', 'entries', 'results', 'boards', 'attacks'];

async function loadRoom(env, code) {
  const room = await fb(env, 'GET', `tetris/rooms/${code}`);
  if (!room) throw new ApiError('room_not_found', 404);
  return room;
}

export const TETRIS_ADMIN = {
  async tetrisCreate(env, body) {
    const name = String(body.name || '').trim().slice(0, 20);
    if (!name) throw new ApiError('bad_request');
    let code = null;
    for (let i = 0; i < 30 && !code; i++) {
      const c = String(1000 + Math.floor(Math.random() * 9000));
      if ((await fb(env, 'GET', `tetris/rooms/${c}/name`)) === null) code = c;
    }
    if (!code) throw new ApiError('server', 500, 'no free code');
    await fb(env, 'PUT', `tetris/rooms/${code}`, { name, created: Date.now() });
    return { code };
  },

  // 다음 판: 방에 있는 모든 학생이 같은 블록 순서(seed)로 같은 시각(start)에 시작
  // 판 id 는 'g1', 'g2' … (숫자만 쓰면 Firebase 가 배열로 바꿔버림)
  async tetrisStart(env, body) {
    const code = roomCode(body.code);
    const room = await loadRoom(env, code);
    const no = ((room.game && Number(room.game.no)) || 0) + 1;
    await fb(env, 'DELETE', `tetris/attacks/${code}`);
    await fb(env, 'PUT', `tetris/rooms/${code}/game`, {
      no, id: 'g' + no, seed: Math.floor(Math.random() * 2147483647), start: Date.now() + COUNTDOWN_MS
    });
    return {};
  },

  // 살아있는 학생들은 강제 종료(stop)로 기록되고, 공격량 순으로 순위가 매겨짐
  async tetrisStop(env, body) {
    const code = roomCode(body.code);
    const room = await loadRoom(env, code);
    if (room.game) await fb(env, 'PUT', `tetris/rooms/${code}/game/over`, true);
    return {};
  },

  async tetrisReset(env, body) {
    const code = roomCode(body.code);
    await loadRoom(env, code);
    await fb(env, 'DELETE', `tetris/rooms/${code}/game`);
    for (const k of ['entries', 'results', 'attacks']) await fb(env, 'DELETE', `tetris/${k}/${code}`);
    return {};
  },

  async tetrisDelete(env, body) {
    const code = roomCode(body.code);
    await fb(env, 'DELETE', `tetris/rooms/${code}`);
    for (const k of ROOM_DATA) await fb(env, 'DELETE', `tetris/${k}/${code}`);
    return {};
  }
};
