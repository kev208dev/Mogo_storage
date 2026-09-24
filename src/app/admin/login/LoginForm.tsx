"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { login } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="mt-6 space-y-3">
      <div>
        <label htmlFor="admin-email" className="mb-1 block text-sm font-semibold">
          이메일
        </label>
        <input
          id="admin-email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="border-border h-11 w-full rounded-md border px-3"
        />
      </div>
      <div>
        <label htmlFor="admin-token" className="mb-1 block text-sm font-semibold">
          접근 토큰
        </label>
        <input
          id="admin-token"
          name="token"
          type="password"
          required
          autoComplete="current-password"
          className="border-border h-11 w-full rounded-md border px-3"
        />
      </div>
      {state?.error ? (
        <p role="alert" className="text-danger-strong text-sm font-semibold">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        로그인
      </Button>
    </form>
  );
}
