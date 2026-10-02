import { Suspense } from "react";
import { MyPortfolios } from "@/components/MyPortfolios";

export default function PortfolioIndexPage() {
  return (
    <>
      <h1>Portfolios</h1>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <MyPortfolios />
      </Suspense>
    </>
  );
}
