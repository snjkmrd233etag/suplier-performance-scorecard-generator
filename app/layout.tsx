import Link from "next/link"
import "./globals.css"
import { Inter } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"
import { Analytics } from "@/components/analytics"
import { ModeToggle } from "@/components/mode-toggle"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "CW SupplierScore",
  description: "Weighted supplier performance scoring for Curtiss-Wright supply chain teams.",
}

interface RootLayoutProps {
  children: React.ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body
        className={`min-h-screen bg-slate-100 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-50 ${inter.className}`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
            <header className="mb-8">
              <div className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white/80 px-5 py-4 shadow-sm shadow-slate-200/70 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-slate-950/30">
                <Link href="/" className="flex flex-col">
                  <span className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700 dark:text-sky-300">
                    Curtiss-Wright
                  </span>
                  <span className="text-lg font-semibold text-slate-950 dark:text-white">
                    Supplier Performance Scorecard Generator
                  </span>
                </Link>
                <ModeToggle />
              </div>
            </header>
            <main>{children}</main>
          </div>
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  )
}
