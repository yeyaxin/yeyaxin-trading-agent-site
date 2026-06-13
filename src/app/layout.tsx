import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { Disclaimer } from "@/components/Disclaimer";
import { PasswordPromptHost } from "@/components/PasswordGate";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Trade — yeyaxin",
  description:
    "Personal multi-agent stock research powered by LLMs. Not investment advice.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <SiteHeader />
        <PasswordPromptHost />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-border mt-16">
          <div className="mx-auto max-w-6xl px-6 py-6 flex items-center justify-between gap-4">
            <Disclaimer compact />
            <p className="text-xs text-muted">
              Built on{" "}
              <a
                href="https://github.com/TauricResearch/TradingAgents"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                TradingAgents
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
