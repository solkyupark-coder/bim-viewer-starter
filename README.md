# 모델 뷰어 · 코멘트 (viewer-starter)

IFC와 DXF를 브라우저에서 열고, 객체를 찍어 코멘트를 남기는 작은 서비스입니다. 패스트캠퍼스 4주차 마지막 한 시간용 틀입니다.

- 뷰어: three.js + web-ifc (IFC), dxf-viewer (DXF)
- 저장: Supabase (파일은 Storage `models` 버킷, 표는 `models`·`comments`)
- 배포: Vercel (Vite 정적 사이트)

## 쓰는 법

1. `supabase.sql`을 내 수파베이스 프로젝트 SQL Editor에 붙여넣고 실행
2. `public/config.js`에 Project URL과 anon key 입력
3. `npm install` → `npm run dev` → `localhost:5173`
4. Claude Code에 "깃허브에 올리고 Vercel로 배포해 줘"

자세한 순서는 `수업안내.md`에 있습니다.

## 키

`config.js`에 들어가는 anon 키는 브라우저에 실리는 공개용 키입니다. `service_role` 키는 어디에도 넣지 않습니다.
