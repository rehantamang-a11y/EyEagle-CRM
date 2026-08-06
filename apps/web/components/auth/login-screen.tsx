"use client";

import * as React from "react";
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { useLogin } from "@/hooks/auth/use-login";
import { ApiError } from "@/services/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginScreen() {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const login = useLogin();
  const errorMessage = login.error instanceof ApiError
    ? login.error.message
    : login.error
      ? "We could not reach the CRM service. Check your connection and try again."
      : null;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    login.mutate({ email: email.trim(), password });
  };

  return <main className="relative grid min-h-svh place-items-center overflow-hidden bg-[var(--bg)] px-4 py-10">
    <div className="absolute inset-x-0 top-0 h-1 bg-[var(--brand)]" aria-hidden="true" />
    <div className="w-full max-w-[420px]">
      <div className="mb-5 flex items-center justify-center gap-3">
        <span className="grid size-10 place-items-center rounded-[7px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--app-panel-shadow)]">
          <img className="size-8" src="/logo.svg" alt="" />
        </span>
        <div>
          <strong className="block text-sm text-[var(--text)]">Eyeagle</strong>
          <span className="block text-[11px] text-[var(--muted)]">Sales desk</span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="mb-3 grid size-9 place-items-center rounded-md bg-[var(--brand-soft)] text-[var(--brand)]" aria-hidden="true"><LockKeyhole size={17} /></div>
          <CardTitle>Sign in to the sales desk</CardTitle>
          <CardDescription>Use your Eyeagle CRM account to manage enquiries and follow-ups.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="email">Email address</Label>
              <Input id="email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@eyeagle.in" autoComplete="username" autoFocus required disabled={login.isPending} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" name="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} className="pr-11" autoComplete="current-password" required disabled={login.isPending} />
                <button type="button" className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-[var(--muted)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {errorMessage && <div className="rounded-md border border-[var(--surface-danger)] bg-[var(--red-soft)] px-3 py-2.5 text-xs leading-5 text-[var(--red)]" role="alert">{errorMessage}</div>}

            <Button className="mt-1 w-full" type="submit" disabled={login.isPending || !email.trim() || !password}>
              {login.isPending && <span className="size-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />}
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="mt-5 flex items-start gap-2 border-t border-[var(--border-subtle)] pt-4 text-[11px] leading-[1.5] text-[var(--faint)]">
            <ShieldCheck className="mt-0.5 shrink-0 text-[var(--green)]" size={15} aria-hidden="true" />
            <p className="m-0">Access is limited by your assigned CRM role. Activity remains subject to server-side authorization.</p>
          </div>
        </CardContent>
      </Card>

      <p className="mt-4 text-center text-[10px] text-[var(--faint)]">Eyeagle internal workspace</p>
    </div>
  </main>;
}
