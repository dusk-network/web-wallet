/**
 * What a send's Max leaves in the public balance: the fee to get at what the
 * wallet holds elsewhere, which only that balance can pay. Emptied, a stake or
 * a withdrawal on its way stays out of reach until DUSK comes in from somewhere
 * else, so Max keeps it, and an amount typed over that goes with a warning.
 * None without anything elsewhere: Max is then all of it.
 */

import { derived } from "svelte/store";

import { withdrawalActivityStore } from "$lib/bridge/withdrawalActivityStorage";
import { getGasSettings } from "$lib/contracts";
import { sozuStore } from "$lib/sozu";
import { gasPriceStore, settingsStore, walletStore } from "$lib/stores";

/**
 * The gas a withdrawal's proof or claim takes at most, as far as can be said
 * before it's worked out: the proofs on testnet and mainnet take about 51M.
 */
const WITHDRAWAL_STEP_GAS = 60_000_000n;

/** Where a withdrawal still has its proof and its claim to come, on Dusk. */
const TO_PROVE = new Set(["ready_to_prove", "submitted", "waiting_for_output"]);

/** Where a withdrawal still has only its claim to come. */
const TO_CLAIM = new Set([
  "proven_waiting",
  "prove_submitted",
  "ready_to_finalize",
]);

/**
 * The most a single step takes: its fee paid, what comes back pays the others.
 *
 * @typedef {{ lux: bigint, why: string }} FeeToKeep
 *   `lux` the fee; `why` what it's for, as "to unstake later"
 */

/**
 * What the public balance must keep: the largest fee of what's elsewhere.
 *
 * @type {import("svelte/store").Readable<FeeToKeep>}
 */
export const feeToKeep = derived(
  [
    walletStore,
    settingsStore,
    gasPriceStore,
    sozuStore,
    withdrawalActivityStore,
  ],
  ([$wallet, $settings, $price, $sozu, $withdrawals]) => {
    const account = String($wallet.currentProfile?.account ?? "");

    /** @param {GasOperation} operation */
    const feeOf = (operation) => {
      const { gasLimit, gasPrice } = getGasSettings(
        operation,
        $settings,
        $price
      );

      return gasLimit * gasPrice;
    };
    const price = $settings.customGasPrice ?? $price;
    const paysHere = $withdrawals.filter(({ recipient }) =>
      recipient ? recipient === account : true
    );
    /** @type {FeeToKeep[]} */
    const fees = [
      ...($wallet.stakeInfo?.amount || ($wallet.stakeInfo?.reward ?? 0n) > 0n
        ? [{ lux: feeOf("unstake"), why: "to unstake later" }]
        : []),
      ...($sozu.account === account &&
      ($sozu.status?.position?.stDusk ?? 0n) > 0n
        ? [{ lux: feeOf("liquid-unstake"), why: "to unstake from Sozu later" }]
        : []),
      ...(paysHere.some(({ stage }) => TO_CLAIM.has(stage))
        ? [
            {
              lux: WITHDRAWAL_STEP_GAS * price,
              why: "to claim your withdrawal",
            },
          ]
        : []),
      ...(paysHere.some(({ stage }) => TO_PROVE.has(stage))
        ? [
            {
              lux: 2n * WITHDRAWAL_STEP_GAS * price,
              why: "to prove and claim your withdrawal",
            },
          ]
        : []),
    ];

    return fees.reduce(
      (most, fee) => (fee.lux > most.lux ? fee : most),
      /** @type {FeeToKeep} */ ({ lux: 0n, why: "" })
    );
  },
  /** @type {FeeToKeep} */ ({ lux: 0n, why: "" })
);
