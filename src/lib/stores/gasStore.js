import { readable } from "svelte/store";
import { LOWEST_GAS_LIMIT_MINIMUM } from "$lib/contracts/gasDefaults";

/**
 * Global gas bounds. The lower gas limit bound is the lowest operation
 * minimum: each operation checks its own, see `getGasLimits`.
 */
const gasLimits = {
  gasLimitLower: LOWEST_GAS_LIMIT_MINIMUM,
  gasLimitUpper: BigInt(import.meta.env.VITE_GAS_LIMIT_UPPER ?? 1_000_000_000),
  gasPriceLower: BigInt(import.meta.env.VITE_GAS_PRICE_LOWER ?? 1),
};

const gasStore = readable(gasLimits);

export default gasStore;
