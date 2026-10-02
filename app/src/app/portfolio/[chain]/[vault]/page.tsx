import { PortfolioRoute } from "@/components/PortfolioRoute";

// /portfolio/<chain>/<vault>: <chain> is a slug (ethereum|base|arbitrum|robinhood|hyperevm) or a numeric chain id.
export default async function PortfolioPage({ params }: { params: Promise<{ chain: string; vault: string }> }) {
  const { chain, vault } = await params;
  return <PortfolioRoute chainParam={chain} vault={vault} />;
}
