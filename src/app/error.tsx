"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-12" role="alert">
      <h1 className="text-2xl font-bold">일시적인 오류가 발생했습니다</h1>
      <p className="text-muted-foreground mt-2">
        잠시 후 다시 시도해 주세요. 문제가 계속되면 다른 시험 페이지에서 오류 신고를 남겨 주세요.
      </p>
      <div className="mt-6 flex gap-2">
        <Button onClick={reset}>다시 시도</Button>
        <Button variant="outline" asChild>
          <Link href="/">홈으로</Link>
        </Button>
      </div>
    </div>
  );
}
