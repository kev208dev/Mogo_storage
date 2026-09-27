import type { Metadata } from "next";
import { SITE_NAME } from "./constants";

/**
 * 허브(학년·연도·월·과목·개념) 페이지 metadata.
 * Next 는 openGraph 를 layout 과 깊게 합치지 않으므로 siteName · locale 까지 여기서 모두 채운다.
 * OG 이미지는 실제 이미지가 없으므로 넣지 않는다.
 */
export function hubMetadata({
  title,
  description,
  path,
  noindex = false,
}: {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      title: `${title} | ${SITE_NAME}`,
      description,
      url: path,
      siteName: SITE_NAME,
      locale: "ko_KR",
    },
    twitter: { card: "summary", title, description },
    robots: noindex ? { index: false, follow: true } : undefined,
  };
}
