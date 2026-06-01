import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Predinex — Stellar Prediction Markets",
  description: "Decentralized prediction markets on Stellar",
};

/**
 * Inline script to prevent flash of unstyled content (FOUC).
 * Runs before any React hydration to set the correct theme class
 * on <html> based on localStorage or system preference.
 */
const themeInitScript = `
  (function() {
    try {
      var theme = localStorage.getItem("predinex-theme") || "system";
      var resolved = theme === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;
      document.documentElement.classList.toggle("dark", resolved === "dark");
    } catch (e) {}
  })();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`
          ${inter.className}
          min-h-screen bg-white text-slate-900
          transition-colors duration-300 ease-in-out
          dark:bg-slate-950 dark:text-slate-100
        `}
      >
        <ErrorBoundary>
          <ThemeProvider>{children}</ThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}