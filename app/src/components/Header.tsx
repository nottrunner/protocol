"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { ChainSwitcher } from "./ChainSwitcher";

export function Header() {
  return (
    <header className="header">
      <nav className="nav">
        <Link href="/" className="brand">Onchain Portfolio</Link>
        <Link href="/create">Create</Link>
        <Link href="/portfolio">View</Link>
      </nav>
      <div className="header-actions">
        <ChainSwitcher />
        <ConnectButton showBalance={false} chainStatus="none" />
      </div>
    </header>
  );
}
