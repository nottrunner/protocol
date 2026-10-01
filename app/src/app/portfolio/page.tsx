import { Suspense } from "react";
import { PortfolioView } from "@/components/PortfolioView";

export default function PortfolioPage() {
  return (
    <>
      <h1>View portfolio</h1>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <PortfolioView />
      </Suspense>
    </>
  );
}
