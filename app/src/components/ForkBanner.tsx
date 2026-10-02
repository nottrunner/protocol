"use client";

import { anyForkDeployment } from "@/lib/contracts";

/** Shown only in QA builds made with NEXT_PUBLIC_USE_FORK_DEPLOYMENTS=1 (fork records embedded). Never in a default build. */
export function ForkBanner() {
  if (!anyForkDeployment()) return null;
  return (
    <div className="notice notice-warn" role="status" style={{ borderRadius: 0, textAlign: "center" }}>
      FORK DEPLOYMENT RECORDS: addresses exist only on a local Anvil fork (test build). Do not use real funds.
    </div>
  );
}
