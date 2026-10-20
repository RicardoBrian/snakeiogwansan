# 🐍 SNAKE.IO (컴퓨터실 대회용)

Firebase Realtime Database + Cloudflare Pages로 동작하는 멀티플레이 뱀 게임입니다.

```
public/                 정적 파일 (게임, 관리자 페이지, Firebase SDK)
functions/api/config.js  GET  /api/config  → 환경변수의 Firebase 주소를 브라우저에 전달
functions/api/admin.js   POST /api/admin   → 관리자 비밀번호 확인 + 관리자 작업 수행
database.rules.json     Firebase 보안 규칙 (콘솔에 붙여넣기)
```

- 관리자 비밀번호와 Firebase 비밀키는 **Cloudflare 비밀(Secret)에만** 저장되고 브라우저로 내려가지 않습니다.
- 라운드 시작/종료, 기록 초기화, 먹이 초기화는 서버(Cloudflare)만 할 수 있습니다. 학생이 개발자 도구로 직접 하려 해도 보안 규칙에 막힙니다.

## 설정 순서

### 1. Firebase 프로젝트 만들기
1. https://console.firebase.google.com → **프로젝트 추가**
2. 이름 입력 → Google 애널리틱스 **사용 안 함** → 프로젝트 만들기

### 2. Realtime Database 만들기
1. 왼쪽 메뉴 **빌드 → Realtime Database → 데이터베이스 만들기**
2. 위치: **싱가포르(asia-southeast1)**
3. **잠금 모드로 시작** → 사용 설정
4. **규칙** 탭 → 내용을 모두 지우고 `database.rules.json` 내용 붙여넣기 → **게시**
5. **데이터** 탭 위쪽 주소 복사 (예: `https://내프로젝트-default-rtdb.asia-southeast1.firebasedatabase.app`)
   → 이것이 `FIREBASE_DATABASE_URL`

### 3. Firebase 데이터베이스 비밀키 복사
1. ⚙️ **프로젝트 설정 → 서비스 계정** 탭
2. **데이터베이스 비밀번호(Database secrets)** → 비밀번호 **표시** → 복사
   → 이것이 `FIREBASE_DB_SECRET` (절대 공개 금지)

### 4. Cloudflare Pages 배포
1. https://dash.cloudflare.com → **Workers 및 Pages → 만들기 → Pages → Git에 연결**
   (Workers 화면이 먼저 나오면 아래쪽 "Pages로 배포" 링크를 누르세요)
2. 이 저장소(`snakeiogwansan`) 선택
3. 빌드 설정
   - 프로덕션 분기: 이 코드가 있는 브랜치
   - 프레임워크 프리셋: **없음**
   - 빌드 명령: **비워둠**
   - 빌드 출력 디렉터리: **`public`**
4. **환경 변수**를 추가합니다 (배포 전 화면에서 넣거나, 나중에 **설정 → 변수 및 비밀**에서 추가)

   | 이름 | 유형 | 값 |
   |---|---|---|
   | `FIREBASE_DATABASE_URL` | 텍스트 | 2-5에서 복사한 주소 |
   | `FIREBASE_DB_SECRET` | **비밀(암호화)** | 3에서 복사한 비밀키 |
   | `ADMIN_PASSWORD` | **비밀(암호화)** | 관리자 비밀번호 (직접 정하기) |

5. 배포 완료 후 주소:
   - 게임: `https://<프로젝트명>.pages.dev/`
   - 관리자: `https://<프로젝트명>.pages.dev/admin`

> 환경 변수를 배포 **후에** 추가/수정했다면 **배포 → 최신 배포 ⋯ → 배포 다시 시도**를 해야 적용됩니다.

### 5. 대회 전 꼭 확인
- 학교 PC에서 게임 주소 접속 → 로그인 화면에 `🟢 서버 연결됨`이 뜨는지 확인 (`pages.dev`, `firebasedatabase.app`이 학교망에서 열리는지)
- 관리자 페이지에서 로그인 → **라운드 종료/시작** 버튼이 동작하는지 확인 (실패하면 오류 메시지에 원인이 나옵니다)

## 대회 진행 방법
1. 관리자 페이지에서 **라운드 종료(입장 잠금)** 상태로 두고 학생들 접속 대기
2. **라운드 시작** → 학생들 입장, 게임 진행 (죽으면 바로 다시 하기 가능)
3. **라운드 종료** → 게임 중이던 학생들의 현재 점수까지 기록되고 게임 종료
4. 전체 순위 확인, **CSV 저장** (엑셀로 열림)
5. 다음 반/다음 대회 전에 **전체 기록 초기화**

## 게임 규칙
- 마우스 방향으로 이동, **클릭 또는 스페이스바 = 부스트** (점수 15 이상, 점수가 조금씩 줄어듦)
- ←/→ (또는 A/D) 키로도 조종 가능
- 다른 뱀 몸에 머리가 닿거나 벽에 닿으면 탈락, 탈락한 뱀은 먹이로 변함
- 다른 학생을 내 몸에 부딪히게 하면 **처치** +1
- 게임 중 다른 창/탭으로 3초 이상 나가면 탈락
- 같은 학번으로 동시에 두 곳에서 접속 불가

## 참고
- Firebase 무료(Spark) 요금제: 동시 접속 100명, 월 다운로드 10GB (30명 1시간 ≈ 3~5GB)
- 학생 플레이 데이터(위치, 먹이, 점수)는 게임 구조상 브라우저에서 직접 씁니다. 교내 대회 수준의 단순한 보호입니다.
