import type { Metadata, Viewport } from "next";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { SITE_NAME } from "@/lib/constants";
import { getSiteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: `${SITE_NAME} - 고1·고2·고3 모고·모의고사 문제지·정답·해설`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "고1·고2·고3 모고·모의고사 문제지와 정답·해설 PDF, 영어 듣기, 자동 채점, 등급컷을 연도·월·과목별로 빠르게 확인하세요.",
  applicationName: SITE_NAME,
  verification: {
    google: "DyKKUXF2xmvO-lT972fru4WJreKZzYWI-qU7PrRee-w",
    other: {
      "naver-site-verification": "5b9da66d2a560cd7ec10b5a5fcd19770e9d14c26",
    },
  },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: SITE_NAME,
    url: "/",
  },
  twitter: { card: "summary" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          본문으로 바로가기
        </a>
        <Header />
        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
