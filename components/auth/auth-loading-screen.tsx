export function AuthLoadingScreen() {
  return <main className="grid min-h-svh place-items-center bg-[var(--bg)] px-4" aria-busy="true" aria-label="Checking your session">
    <div className="grid justify-items-center gap-3 text-[var(--muted)]">
      <span className="size-6 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--brand)]" aria-hidden="true" />
      <span className="text-xs">Checking your session…</span>
    </div>
  </main>;
}
