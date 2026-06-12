import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-white/80 backdrop-blur sticky top-0 z-10">
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
        <Link href="/" className="font-semibold tracking-tight text-foreground">
          yeyaxin <span className="text-accent">/trade</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm text-muted">
          <Link href="/portfolio" className="hover:text-foreground">
            Portfolios
          </Link>
          <Link href="/history" className="hover:text-foreground">
            History
          </Link>
        </nav>
      </div>
    </header>
  );
}
