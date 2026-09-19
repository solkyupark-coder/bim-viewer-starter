# 모델 뷰어 · 코멘트 (viewer-starter)

IFC·DWG·PDF를 브라우저에서 열고, 프로젝트별로 객체를 찍어 코멘트를 남기는 작은 서비스입니다. 패스트캠퍼스 4주차 마지막 한 시간용 틀입니다.

- 뷰어: three.js + web-ifc (IFC), dxf-viewer (DXF), pdf.js (PDF)
- 저장: Supabase — 파일은 Storage(`models`·`drawings`·`photos`), 표는 `projects`·`models`·`comments`·`drawings`·`events`
- 배포: Vercel (Next.js)

## 쓰는 법

1. 이 폴더에서 Claude Code를 엽니다. `.mcp.json` 승인 → `/mcp` → `supabase` → Authenticate (GitHub 로그인).
2. Claude Code에 한 문장씩:
   - "수파베이스 연동해 줘" — 표·버킷·실시간 설정을 MCP로 만들고 `.env.local`을 채웁니다.
   - "npm install 하고 dev 서버 켜서 열어 줘" — `localhost:5173`, 왼쪽 위가 **연결됨**이면 된 겁니다.
   - "깃허브에 올리고 Vercel로 배포해 줘" — 주소가 나오면 옆 사람 폰으로 엽니다.

절차의 세부는 `CLAUDE.md`에 있고, Claude Code가 그걸 읽고 따릅니다. SQL을 직접 붙여넣거나 키를 복사할 일은 없습니다.

## 키

`.env.local`의 anon 키는 브라우저에 실리는 공개용 키입니다. `service_role` 키는 어디에도 넣지 않습니다. `.env.local`은 깃허브에 올라가지 않으니, Vercel엔 환경변수로 따로 넣습니다.

## 프로젝트 삭제

프로젝트 이름 옆 **삭제**를 누르면 삭제 코드를 묻습니다. 코드는 DB 함수가 확인하므로 anon 키만으로는 지울 수 없습니다. 기본 코드와 바꾸는 법은 `supabase.sql` 5번 항목에 있습니다.
