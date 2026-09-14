# 다음 AI 에이전트를 위한 작업 인수인계서 (Handoff Document)

## 📌 현재 상황 요약 (Context)
- **프로젝트**: 산초(Sancho) - Node.js 내장 모듈만 사용하는 Zero-dependency 개인 비서 및 업무 플랫폼.
- **최근 완료된 작업**: 13개 플랫폼 모듈 구축 완료, 불필요한 '부서 도구함' 기능 완벽 제거, 에러 수정 및 안정화(selftest.js, probe.js 통과).
- **작업 원칙**: 
  - `npm install` 절대 금지 (Node.js 내장 모듈만 사용).
  - 클라이언트 라이브러리는 CDN만 허용.
  - 모든 UI와 주석은 한국어(높임말) 원칙. 화이트 톤 디자인 (`platform.css` 재사용).
  - **작업 도중 사용자에게 묻지 않고(Always Proceed) 알아서 끝까지 구현 후 깃허브 푸시까지 완료할 것.**

---

## 🚀 즉시 실행해야 할 1순위 작업: 멀티유저 로그인 시스템 구축

현재 로컬 호스트 전용인 시스템을 사내망(LAN)에서 여러 명이 각자의 계정으로 접속해 사용할 수 있도록 개편해야 합니다. 아래 스펙을 **정확히** 구현하세요.

### 1. 백엔드 (`server.js`) 변경 스펙
1. **서버 바인딩**: 현재 `127.0.0.1`로 되어 있는 부분을 `0.0.0.0`으로 변경하여 외부(LAN) 접속 허용.
2. **비밀번호 해싱**: Node.js 내장 `crypto.scryptSync`와 `crypto.randomBytes` 사용 (외부 패키지 절대 금지).
3. **인증 API 추가**: 
   - `POST /api/auth/login`
   - `POST /api/auth/logout`
   - `GET /api/auth/me`
4. **세션 관리**: `crypto.randomUUID()`로 세션 토큰을 발급하고 메모리 Map이나 `data/sessions.json`에 저장.
5. **API 라우터 보호**: `/api/db/**` 등 주요 API 호출 시 세션 검증 로직 추가.

### 2. 프론트엔드 변경 스펙
1. **`public/login.html` 신규 생성**: 기존 `platform.css`를 활용하여 깔끔한 화이트 톤의 로그인 화면 구현.
2. **`public/index.html` (Auth Guard)**: 페이지 로드 시 `/api/auth/me`를 체크하여 401 에러 시 `login.html`로 리다이렉트. 우측 상단 `ownerUI()`에 '로그아웃' 버튼 추가.
3. **`public/m/sdb.js`**: `fb.me()` 함수가 하드코딩된 owner가 아닌, 실제 로그인한 유저 정보를 반환하도록 수정.

### 3. 데이터 및 권한 구조 스펙
1. **유저 스키마**: 기존 `data/db/users.json`에 `loginId`, `salt`, `passwordHash` 필드 추가.
2. **최초 실행 시딩(Seeding)**: 등록된 유저가 한 명도 없을 경우 `admin` / `admin123` 계정 자동 생성.
3. **데이터 격리 (Multi-tenant)**: 개인 데이터(채팅, memory.md, schedules.json, settings.json, 개인 옵시디언 등)는 `data/users/<userId>/` 하위 폴더에 격리하여 저장하도록 백엔드 로직 수정.
4. **RBAC 권한**: `super`(관리자), `manager`(팀장), `member`(팀원) 권한 구조 유지.

---

## 💡 2순위 작업 (로그인 완료 후 진행): 워크플로우 캔버스 (Sancho Flow)
- **목표**: n8n처럼 시각적으로 노드를 연결해 워크플로우를 짜는 화면 구축.
- **구현 스펙**: CDN을 통해 `Drawflow` 라이브러리(cdnjs) 로드. `public/m/flow.html` 생성 및 `index.html` 메뉴에 `{ id: 'flow', icon: '🔀', label: '워크플로우' }` 추가.

---

## 🤖 다음 에이전트 행동 지침
이 문서를 읽었다면, 즉시 위 **"1순위 작업: 멀티유저 로그인 시스템 구축"**에 대한 Implementation Plan(구현 계획)을 짤 필요 없이 **바로 코드 수정을 시작**하세요. 에러 없이 `node selftest.js` 통과까지 확인한 후 `git push`로 마무리하세요.
