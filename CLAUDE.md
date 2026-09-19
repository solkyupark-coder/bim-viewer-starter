# 모델 뷰어 · 코멘트 — Claude Code 작업 규칙

수업용 스타터입니다. 사용자는 개발자가 아닙니다. 짧게 말하고, 명령을 대신 치고, 확인은 증거로 합니다.

## 앱 구조

- Next.js 15. 화면은 `app/page.js` → `components/Studio.jsx`. `src/`·`index.html`·`public/config.js`는 옛 버전 잔재이므로 건드리지 않습니다.
- 수파베이스 키는 **`.env.local`** 에서만 읽습니다 (`lib/supabase.js`). `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `public/config.js`에 넣어도 앱은 안 읽습니다.
- `NEXT_PUBLIC_*`는 dev 서버를 켤 때 박히므로 `.env.local`을 바꾸면 dev 서버를 **재시작**해야 합니다.
- 스키마는 `supabase.sql` 한 파일이 전부입니다. 표 6개(projects, models, comments, drawings, events, app_settings), 버킷 3개(models, photos, drawings), RLS, Realtime publication, 삭제 함수 `delete_project`까지 들어 있고 몇 번을 돌려도 안전합니다.
- 프로젝트가 기준입니다. `projects` 표에 한 행, 모델·코멘트는 `project_id`로 그 프로젝트에 묶입니다. 화면은 프로젝트를 바꾸면 그 프로젝트의 모델·코멘트만 보여 줍니다.

## "수파베이스 연동해 줘" 라고 하면 — 이 순서대로, 묻지 말고 진행

사용자에게 SQL Editor에 붙여넣으라거나 키를 복사해 오라고 **시키지 않습니다.** 전부 수파베이스 MCP로 합니다.

0. 수파베이스 MCP 도구(`mcp__supabase__*`)가 안 보이면 진행하지 말고 이렇게만 안내하고 멈춥니다:
   「`/mcp` → `supabase` → Authenticate → 브라우저에서 GitHub로 로그인한 뒤 다시 말해 주세요.」
1. `list_projects`. 프로젝트가 하나면 그걸 씁니다. 여럿이면 이름을 나열하고 어느 걸 쓸지 묻습니다.
   하나도 없으면 `get_cost`(project, 해당 org)로 비용이 0인지 확인한 뒤 `confirm_cost` → `create_project`(이름 `viewer`, 리전 `ap-northeast-2`)로 만듭니다. 비용이 0이 아니면 만들지 말고 묻습니다. 새로 만들면 ACTIVE_HEALTHY가 될 때까지 `get_project`로 기다립니다.
2. `supabase.sql`을 읽어 `apply_migration`(name: `init_viewer`)으로 **파일 내용 그대로 한 번에** 실행합니다. 나누거나 고치거나 다시 쓰지 않습니다.
3. 증거로 확인합니다. 하나라도 빠지면 무엇이 빠졌는지 말하고 멈춥니다.
   - `list_tables`(schema public)에 projects, models, comments, drawings, events, app_settings
   - `execute_sql`: `select has_function_privilege('anon', 'public.delete_project(uuid, text)', 'execute')` → true
   - `execute_sql`: `select column_name from information_schema.columns where table_name in ('models','comments') and column_name = 'project_id'` → 두 줄
   - `execute_sql`: `select id, public from storage.buckets` → models, photos, drawings 모두 public = true
   - `execute_sql`: `select tablename from pg_publication_tables where pubname = 'supabase_realtime'` → projects, comments, drawings, events
4. `get_project_url`, `get_publishable_keys`로 URL과 anon(publishable) 키를 받아 `.env.local`에 씁니다. `.env.example`의 세 줄 형식 그대로, `NEXT_PUBLIC_TITLE`은 비어 있으면 `기록`. service_role 키는 어디에도 쓰지 않습니다.
5. 켜져 있던 dev 서버를 끄고 `npm run dev`로 다시 켠 뒤 `http://localhost:5173`을 엽니다.
6. 마지막에 사용자에게 딱 두 가지만 확인하라고 말합니다: 화면 왼쪽 위가 **연결됨**인지, 샘플 IFC를 올렸을 때 수파베이스 Table Editor의 `models` 표에 행이 생기는지.

`get_advisors`를 돌리면 RLS가 열려 있다는 경고가 나옵니다. 수업용으로 의도한 것이니 고치지 않습니다.

## "깃허브에 올리고 Vercel로 배포해 줘" 라고 하면

- `.env.local`은 `.gitignore`에 있어 올라가지 않습니다. 배포 전에 `.env.local`의 두 값을 `vercel env add`로 Production에 넣습니다. 안 넣으면 배포된 주소는 "로컬" 모드로 뜹니다.
- 배포 주소를 알려 주고, 다른 기기(옆 사람 폰)에서 열어 보라고 합니다. "Deployed"는 확인이 아닙니다.

## 프로젝트 삭제 코드

- 기본 코드는 `1234`. 바꾸려면 `supabase.sql` 5번 항목의 update 문을 `execute_sql`로 돌립니다. 코드는 해시로만 저장되며 대화나 파일에 평문으로 남기지 않습니다.
- 삭제해도 Storage의 실제 파일은 남습니다. 대시보드 Storage에서 지웁니다.

## 절대 하지 않는 것

- service_role 키, DB 비밀번호를 파일이나 대화에 쓰기
- `supabase.sql`을 임의로 수정하기
- 표·버킷·프로젝트 삭제
