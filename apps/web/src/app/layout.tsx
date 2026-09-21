import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono, Manrope } from "next/font/google";
import { Providers } from "@/components/providers";
import { ServerStatus } from "@/components/server-status";
import "./globals.css";

const display = Instrument_Serif({ variable: "--font-serif-display", weight: "400", subsets: ["latin"] });
const body = Manrope({ variable: "--font-body", subsets: ["latin"] });
const code = JetBrains_Mono({ variable: "--font-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Prep Kit", template: "%s · Prep Kit" },
  description: "Turn a job description into an interview prep kit you can edit, schedule and practise.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes sets the theme class on <html> before React starts, which React would otherwise report as a mismatch.
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable} ${code.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <Providers>
          <ServerStatus />
          {children}
        </Providers>
      </body>
    </html>
  );
}
