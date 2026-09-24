export function NoDatabase() {
  return (
    <p className="border-border rounded-md border p-4 text-sm">
      DATABASE_URL 이 설정되지 않아 수집 현황을 볼 수 없습니다. (샘플 데이터 모드)
    </p>
  );
}
