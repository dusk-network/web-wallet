// The capture's config: the app's test config, on capture.spec.js alone,
// against testnet's node, with Node's fetch kept for its reads.
import { resolve } from "node:path";

import appConfig from "../../vite.config.js";

export default (/** @type {import("vite").ConfigEnv} */ env) => {
  const config = appConfig({ ...env, mode: "test" });
  const test = config.test ?? {};

  return {
    ...config,
    test: {
      ...test,
      env: {
        ...test.env,
        VITE_NODE_URL:
          process.env.CAPTURE_NODE_URL ?? "https://testnet.nodes.dusk.network",
      },
      hookTimeout: 900_000,
      include: ["scripts/withdrawal-calls/capture.spec.js"],
      setupFiles: [
        resolve("scripts/withdrawal-calls/keep-fetch.js"),
        ...[test.setupFiles ?? []].flat(),
      ],
      testTimeout: 900_000,
    },
  };
};
