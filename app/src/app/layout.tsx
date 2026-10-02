import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ForkBanner } from "@/components/ForkBanner";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Onchain Portfolio",
  description: "Create and manage onchain portfolios across Ethereum, Base, Arbitrum and Robinhood Chain.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <ForkBanner />
          <Header />
          <main className="main">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
