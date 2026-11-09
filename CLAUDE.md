# snakeiogwansan 작업 지침 (SNAKE.IO 컴퓨터실 대회)

Firebase 실시간 DB 로 동작하는 멀티플레이 뱀 게임 + 관리자·전광판. 설정·대회 진행법은 `README.md`.

## 구조
- 빌드 없음. `public/` 이 배포된다. `game.js` 게임, `admin.html/js` 관리자, `board.html/js` 전광판(`/board?code=1234`), `i18n.js` 4개 언어.
- `public/lib/` Firebase SDK 사본(고치지 않는다).
- `functions/api/config.js` — `GET /api/config`: Firebase 주소를 브라우저에 전달.
- `functions/api/admin.js` — `POST /api/admin`: 관리자 비밀번호 확인, 게임방·라운드·승점(서버만 가능).

## DB — Firebase 실시간 DB
- 주소는 Cloudflare 비밀값 `FIREBASE_DATABASE_URL`. 경로: `players`, `scores`, `roomIndex`, `notices`, `settings/locked`.
- 규칙 `database.rules.json` — **자동 배포 안 됨**, 콘솔 → Realtime Database → 규칙에 붙여넣어 게시. 고쳤으면 사용자에게 알린다.
- Cloudflare 비밀값: `FIREBASE_DATABASE_URL`, `FIREBASE_DB_SECRET`, `ADMIN_PASSWORD`(+`FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`). 바꾼 뒤엔 재배포.

## 배포
- Cloudflare Pages, Build command 비움, output `public`. 주소는 확인되면 여기에 적는다.

## 테스트
- 자동 테스트 없음. 대회 전 학교 PC에서 `🟢 서버 연결됨` 확인(README "대회 전 꼭 확인").

## 작업 원칙
- 고치기 전에 **실제 오류 메시지를 먼저 확보**한다. 메시지 없이 추측으로 고치지 않는다.
  사용자에게 확인을 부탁할 때는 열어볼 주소·볼 곳을 하나로 정확히 준다.
- 잘 되던 기능은 요청 없이 건드리지 않는다. 원인이 확인되면 그 원인만 고치고, "겸사겸사" 개선은 먼저 묻는다.
- 같은 문제로 두 번 고쳐도 안 되면 멈추고, 확인한 사실과 모르는 것을 정리해 보고한다.
- 사용자에게는 한국어로, 짧게, 무엇을 바꿨고 무엇을 확인했는지(확인 못 한 것도) 말한다.
- 전체 DB 지도는 `RicardoBrian/Ohweb` 의 `DB.md`. 컬렉션을 새로 만들면 그 표도 고친다.
