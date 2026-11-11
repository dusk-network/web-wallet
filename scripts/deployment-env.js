#!/usr/bin/env node
/**
 * The settings deployments.json lists for a site, as lines of KEY=value. The
 * deploy workflow adds them to its environment and builds the site with them,
 * as scripts/verify-build.js rebuilds it.
 *
 *   node scripts/deployment-env.js https://apps.testnet.dusk.network/wallet/ >> "$GITHUB_ENV"
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { settingProblem } from "./verify-build.js";

/**
 * A site's settings in deployments.json as lines of KEY=value, by key: each a
 * VITE_ setting of plain text, so that it takes one line, or none at all.
 *
 * @param {Record<string, Record<string, string>>} deployments
 * @param {string} site
 */
export const envLines = (deployments, site) => {
  const settings = Object.hasOwn(deployments, site) ? deployments[site] : null;

  if (!settings) {
    throw new Error(`deployments.json doesn't list ${site}`);
  }

  return Object.entries(settings)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => {
      const problem = settingProblem(key, value);

      if (problem) {
        throw new Error(`deployments.json gives ${site} ${problem}`);
      }

      return `${key}=${value}\n`;
    })
    .join("");
};

// Run, not imported by the tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [site, ...rest] = process.argv.slice(2);

  if (!site || rest.length) {
    console.error("Usage: node scripts/deployment-env.js <site>");
    process.exit(2);
  }

  try {
    const deployments = JSON.parse(
      readFileSync(new URL("../deployments.json", import.meta.url), "utf8")
    );

    process.stdout.write(envLines(deployments, site));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
