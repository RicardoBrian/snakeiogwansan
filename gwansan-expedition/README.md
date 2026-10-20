# ⛏ 관산 유적 탐험대 — 관산 게임왕 참가 신청 웹앱

관산 박사가 안내하는 대화형 신청 페이지입니다. 빌드 도구 없이
**Cloudflare Pages(화면) + Firebase Firestore(신청 데이터 저장)** 로 동작합니다.

```
gwansan-expedition/       ← Cloudflare Pages "루트 디렉터리"
├─ firebase.json          Firestore 규칙·에뮬레이터 설정
├─ firestore.rules        보안 규칙 (생성만 허용, 관리자만 읽기)
├─ tests/                 개발용 도구 (배포에 포함 안 됨)
│  ├─ package.json        로컬 서버·에뮬레이터·규칙 테스트 스크립트
│  └─ rules.test.js       보안 규칙 자동 테스트
└─ public/                ← Cloudflare Pages "빌드 출력 디렉터리" (그대로 배포됨)
   ├─ index.html          신청 페이지 (학생용)
   ├─ admin.html          탐사대 장부 (관리자용, 주소: /admin)
   ├─ firebase-config.js  ★ Firebase 설정값 + 관리자 이메일 (직접 채우기)
   ├─ shared.js           대회 정보(종목·시간·장소·규칙) — 내용 수정은 여기서
   ├─ app.js / style.css  신청 흐름, 디자인
   ├─ admin.js / admin.css
   ├─ _headers / 404.html Cloudflare Pages용 헤더, 없는 주소 안내
   └─ assets/bgm.mp3      ★ 배경음악 (직접 넣기, 없어도 동작)
```

## 대회 정보 반영 내용
- 장소 **컴퓨터실**: 상단 바(모든 화면 고정), 시작 화면, 등록증, 유적 카드, 지도, 선택·확인·완료 화면에 반복 표시
- 1부 9:40~10:20 끄투온라인(말의 신전)·테트리스(무너지는 탑) / 2부 10:30~11:15 오목(돌의 미궁)·지렁이 게임(뱀의 동굴)
- 규칙 3개, "선정 결과는 축제 당일 아침에 공지", "게임에서 승리하고 상품을 받아가세요!"
- **중복 신청 허용**. 같은 부 두 종목을 고르면 선택 화면·확인 화면·완료 화면에서
  "같은 시간대라 한 종목만 선정될 수도 있다" 경고 표시. 관리자 페이지에도 ⚠ 표시·필터 있음.

## 1. Firebase 준비 (데이터 저장소, 처음 한 번)
1. https://console.firebase.google.com → **프로젝트 추가** (애널리틱스 꺼도 됨)
2. **빌드 → Firestore Database → 데이터베이스 만들기** → 위치 `asia-northeast3 (서울)` → **프로덕션 모드**
3. **빌드 → Authentication → 시작하기 → 로그인 방법 → Google 사용 설정**
4. **Authentication → 설정 → 승인된 도메인 → 도메인 추가**: `<Pages프로젝트명>.pages.dev`
   (직접 연결한 도메인이 있으면 그것도 추가). **이걸 빼먹으면 관리자 로그인이 안 됩니다.**
5. ⚙️ **프로젝트 설정 → 내 앱 → 웹(</>) 앱 추가** → 나오는 `firebaseConfig` 값을
   `public/firebase-config.js`의 `FIREBASE_CONFIG`에 붙여넣기 (공개돼도 되는 값입니다)
6. 관리자 이메일 두 곳을 **내 Google 계정**으로 바꾸기
   - `public/firebase-config.js` → `ADMIN_EMAIL` (화면용)
   - `firestore.rules` → `request.auth.token.email == "..."` (실제 보안)
7. **보안 규칙 게시** — 둘 중 하나
   - 콘솔: **Firestore Database → 규칙** 탭 → 내용 전부 지우고 `firestore.rules` 내용 붙여넣기 → **게시**
   - 명령어: `cd gwansan-expedition/tests && npm install && npx firebase login && npx firebase deploy --only firestore:rules --project <프로젝트ID>`
8. 배경음악: 저작권 없는 음원을 `public/assets/bgm.mp3`로 저장 (없으면 그냥 무음)

## 2. Cloudflare Pages 배포
기존 지렁이 게임과 같은 저장소를 쓰되, **Pages 프로젝트를 하나 더** 만듭니다.

1. https://dash.cloudflare.com → **Workers 및 Pages → 만들기 → Pages → Git에 연결** → 저장소 `snakeiogwansan` 선택
2. 프로젝트 이름: 예) `gwansan-expedition` → 주소가 `https://gwansan-expedition.pages.dev`가 됨
3. 빌드 설정

   | 항목 | 값 |
   |---|---|
   | 프로덕션 분기 | 이 코드가 있는 브랜치 |
   | 프레임워크 프리셋 | **없음** |
   | 빌드 명령 | **비워둠** |
   | 빌드 출력 디렉터리 | **`public`** |
   | 루트 디렉터리(고급) | **`gwansan-expedition`** |

   > 루트 디렉터리를 꼭 `gwansan-expedition`으로 지정하세요. 비워두면 지렁이 게임(`/public`, `/functions`)이 배포됩니다.
   > 환경 변수·비밀은 필요 없습니다 (Firebase 설정은 `firebase-config.js`에 있음).
4. **저장 및 배포** → 완료 후
   - 신청 페이지: `https://<프로젝트명>.pages.dev/`
   - 관리자 페이지: `https://<프로젝트명>.pages.dev/admin`
5. (선택) 기존 지렁이 게임 프로젝트가 이 폴더 수정 때마다 다시 빌드되지 않게 하려면, 두 프로젝트의
   **설정 → 빌드 → 빌드 감시 경로**에서 각각 `gwansan-expedition/*` 포함 / 제외로 나눠두면 됩니다.

이후에는 브랜치에 푸시하면 자동으로 다시 배포됩니다. `firestore.rules`를 바꿨다면 1-7의 규칙 게시를 다시 하세요
(규칙은 Cloudflare가 아니라 Firebase에 올라갑니다).

Git 연결 없이 바로 올리고 싶으면:
```bash
cd gwansan-expedition/tests && npm install
npx wrangler login
npx wrangler pages deploy ../public --project-name gwansan-expedition
```

## 3. 테스트 방법

### (1) 흐름만 빠르게 보기 — 저장 안 함
배포된 주소나 로컬 주소 뒤에 `?demo=1`을 붙이면 Firestore에 쓰지 않고 끝까지 체험할 수 있습니다.
(화면에 "체험 모드" 표시가 나옵니다)

### (2) 로컬에서 전체 테스트 — 실제 서버에 영향 없음 (Node 18+, Java 11+ 필요)
```bash
cd gwansan-expedition/tests
npm install
npm run emulators     # 터미널 1: Firestore·Auth 에뮬레이터
npm run dev           # 터미널 2: Cloudflare Pages 로컬 서버 (wrangler pages dev)
```
- 신청 페이지: http://127.0.0.1:5000 (localhost에서는 자동으로 에뮬레이터에 저장, 완료 화면에 "에뮬레이터에 저장됨" 표시)
- 저장된 데이터 보기: http://127.0.0.1:4000/firestore
- 관리자 페이지: http://127.0.0.1:5000/admin → 로그인 창에서 **Add new account** → 이메일 `qjatjr7575@gmail.com`
  (에뮬레이터도 이 폴더의 `firestore.rules`를 쓰므로 규칙에 적힌 관리자 이메일로)
- localhost에서 실제 Firebase에 붙이고 싶으면 주소에 `?emu=0`

### (3) 보안 규칙 자동 테스트
```bash
cd gwansan-expedition/tests && npm run test:rules
```
확인 항목: 학생 신청 생성 OK(같은 부 중복 포함) / 같은 학번 두 번째 신청 거부 / 학번 5자리·종목 이름·이름 길이·추가 필드·시각 위조 거부 /
학생 읽기·수정·삭제 거부 / 관리자만 목록 읽기 (이메일 인증 안 된 계정 거부) / 관리자도 수정·삭제 불가.

### (4) 배포 후 직접 확인할 것 (휴대폰으로)
- [ ] 학교 와이파이/LTE에서 `pages.dev` 주소가 열리는지 (Firebase 라이브러리는 `gstatic.com`, 저장은 `firestore.googleapis.com`)
- [ ] 학번 4자리 입력 → "학번은 숫자 5자리일세!" 오류
- [ ] 1부 두 종목 선택 → "한 종목만 선정될 수도" 경고
- [ ] 신청 → 바위 연출 → 도장 → 완료 화면 문구 (`○○ 탐험가, 1부 9:40까지 컴퓨터실로 집결하게!`)
- [ ] **같은 학번으로 다시 신청** → "이미 탐사대 장부에 새겨져 있다네!" 오류
- [ ] /admin 에 내 계정으로 로그인 → 목록·CSV 저장 / 다른 계정으로 로그인 → 거부
- [ ] 테스트로 넣은 신청서는 Firebase 콘솔 → Firestore에서 직접 삭제 (앱에서는 삭제 불가)

## 동작 메모
- **중복 방지**: 문서 ID가 학번이라 같은 학번의 두 번째 저장은 "수정"이 되고, 규칙이 수정을 막습니다.
  학생이 잘못 신청했다면 관리자가 Firebase 콘솔에서 해당 문서를 지운 뒤 다시 신청하게 하세요.
- **학번 형식** 변경: `public/app.js`의 `STUDENT_ID_RE`와 `firestore.rules`의 `'^[0-9]{5}$'`를 함께 수정.
- **종목 이름** 변경: `public/shared.js`의 `game`과 `firestore.rules`의 `hasOnly([...])` 목록을 함께 수정.
- **접근성**: 대사는 말풍선 클릭/탭, 엔터, 스페이스로 넘김 + "대사 건너뛰기" 버튼, 바위 연출엔 "애니메이션 건너뛰기" 버튼.
  기기에서 "동작 줄이기"(prefers-reduced-motion)를 켜면 타자 효과·바위 연출 없이 바로 진행. 화면 낭독기에는 대사 전체가 한 번에 읽힘.
- **BGM**: [탐사 시작]을 누른 뒤에만 재생, 오른쪽 위 🔊/🔇로 끄고 켬(기기에 기억). 파일이 없으면 조용히 무시.
- 관산 박사 그림은 `app.js`의 SVG로 직접 그린 오리지널 캐릭터입니다.
