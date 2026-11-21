import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

const workerName = process.env.KANGXI_WORKER_NAME || "kangxi-backend";
const d1Name = process.env.KANGXI_D1_NAME || "kangxi-db";
const d1Id = process.env.CLOUDFLARE_D1_ID || undefined;

export default defineConfig({
  worker: {
    name: workerName,
    entrypoint,
    compatibilityDate: "2026-11-01",
    workersDev: true,
    exports: {
      SyncHub: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      DB: bindings.d1(d1Id ? { name: d1Name, id: d1Id } : { name: d1Name }),
      SYNC_HUB: bindings.durableObject({
        worker: workerName,
        exportName: "SyncHub",
      }),
      APP_VERSION: bindings.text("0.1.0"),
      FCM_PROJECT_ID: bindings.text(process.env.FCM_PROJECT_ID || ""),
    },
  },
});
