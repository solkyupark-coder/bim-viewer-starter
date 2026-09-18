import './globals.css';

export const metadata = {
  title: '기록',
  description: '여러 명이 남긴 설계가 DB에 쌓인다',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
