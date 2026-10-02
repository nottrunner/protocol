import Link from "next/link";
import { supportedChains } from "@/config/chains";
import { featureFlags } from "@/config/features";
import { getDeployment } from "@/lib/deployments";

export default function HomePage() {
  return (
    <>
      <h1>Onchain Portfolio</h1>
      <p className="muted">Create a portfolio vault, deposit, and redeem, on four chains.</p>
      <div className="row">
        <Link className="btn" href="/create">Create portfolio</Link>
        <Link className="btn btn-secondary" href="/portfolio">View portfolio</Link>
      </div>
      <h2>Supported networks</h2>
      <table className="table">
        <thead><tr><th>Network</th><th>Chain ID</th><th>Create</th><th>Deposit / redeem</th><th>Swap</th></tr></thead>
        <tbody>
          {supportedChains.map((c) => {
            const f = featureFlags[c.id];
            return (
              <tr key={c.id}>
                <td>{c.name}</td><td>{c.id}</td>
                <td>{f.create ? "Yes" : "No"}</td>
                <td>{f.deposit && f.redeem ? "Yes" : "No"}</td>
                <td>{f.swap && getDeployment(c.id).swapAdapters.length > 0 ? "Yes" : "Not enabled"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
