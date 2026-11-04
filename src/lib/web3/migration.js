import {
  getBalance,
  getPublicClient,
  readContract,
  simulateContract,
  writeContract,
} from "@wagmi/core";
import ERC20Abi from "./abi/erc_bep_20.json";
import migrationABI from "./abi/migrationABI.json";
import { outcomeUnknown } from "$lib/transactions/outcomeUnknown";
import { wagmiConfig } from "./walletConnection";

/**
 * Retrieves the allowance amount for DUSK for a given spender and account.
 *
 * @param {`0x${string}`} userAddress - The address of the user to check if it gave an allowance to the migration contract.
 * @param {`0x${string}`} stableCoinAddress - contract address for the coin.
 * @param {`0x${string}`} migrationContract - migration contract address for the the coin.
 * @param {number} [chainId] - the chain the coin is on
 * @returns {Promise<bigint>} - A promise that resolves to the allowed amount.
 * @throws {Error} - Throws an error if there is an issue with retrieving the allowance.
 */
export const allowance = async (
  userAddress,
  stableCoinAddress,
  migrationContract,
  chainId
) => {
  try {
    return /** @type {bigint} */ (
      await readContract(wagmiConfig, {
        abi: ERC20Abi,
        address: stableCoinAddress,
        args: [userAddress, migrationContract],
        chainId,
        functionName: "allowance",
      })
    );
  } catch (e) {
    const errorMessage =
      e instanceof Error
        ? `An error occurred while checking the spender: ${e.message}`
        : "An unexpected error occurred while checking the spender";
    throw new Error(errorMessage);
  }
};

/**
 * Approves a spender to transfer a specified amount of DUSK on behalf of the caller.
 *
 * @param {`0x${string}`} migrationContract - migration contract address for the the coin.
 * @param {`0x${string}`} stableCoinAddress - contract address for the coin.
 * @param {bigint} value - The amount of DUSK to approve.
 * @param {number} [chainId] - the chain the coin is on
 * @param {`0x${string}`} [owner] - the account reviewed: it signs, or nothing does
 * @returns {Promise<`0x${string}`>} - Transaction hash.
 * @throws {Error} - Throws an error if there is an issue with the approval transaction.
 */
export const approve = async (
  migrationContract,
  stableCoinAddress,
  value,
  chainId,
  owner
) => {
  try {
    return await writeContract(wagmiConfig, {
      abi: ERC20Abi,
      account: owner,
      address: stableCoinAddress,
      args: [migrationContract, value],
      chainId,
      functionName: "approve",
    });
  } catch (e) {
    const errorMessage =
      e instanceof Error
        ? `An error occurred while approving the DUSK: ${e.message}`
        : "An unexpected error occurred while approving the DUSK";
    throw new Error(errorMessage);
  }
};

/**
 * Retrieves the balance of the DUSK for a given account.
 *
 * @param {`0x${string}`} userAddress - The address of the account to check the balance for.
 * @param {`0x${string}`} stableCoinAddress - contract address for the coin.
 * @param {number} [chainId] - the chain the coin is on
 * @returns {Promise<bigint>} - A promise that resolves to the balance of the DUSK.
 * @throws {Error} - Throws an error if there is an issue with retrieving the balance.
 */
export const getBalanceOfCoin = async (
  userAddress,
  stableCoinAddress,
  chainId
) => {
  try {
    return /** @type {bigint} */ (
      await readContract(wagmiConfig, {
        abi: ERC20Abi,
        address: stableCoinAddress,
        args: [userAddress],
        chainId,
        functionName: "balanceOf",
      })
    );
  } catch (e) {
    const errorMessage =
      e instanceof Error
        ? `An error occurred while checking the spender: ${e.message}`
        : "An unknown error occurred while checking the spender";
    throw new Error(errorMessage);
  }
};
/**
 * What an account holds of its chain's own currency, which pays its fees.
 *
 * @param {`0x${string}`} owner
 * @param {number} chainId
 * @returns {Promise<bigint>}
 */
export const getNativeBalance = async (owner, chainId) =>
  (await getBalance(wagmiConfig, { address: owner, chainId })).value;

/** About what a migration takes, where it can't be asked before its approval. */
const MIGRATE_GAS_FALLBACK = 70_000n;

/**
 * About what a migration costs in network fees, its approval too where it
 * needs one, at the chain's price now.
 *
 * @param {{
 *   amount: bigint,
 *   approved: boolean,
 *   chainId: number,
 *   migrationContract: `0x${string}`,
 *   owner: `0x${string}`,
 *   recipient: string,
 *   stableCoinAddress: `0x${string}`,
 * }} migration
 * @returns {Promise<bigint>}
 */
export async function getMigrationFee({
  amount,
  approved,
  chainId,
  migrationContract,
  owner,
  recipient,
  stableCoinAddress,
}) {
  const client = /** @type {import("viem").PublicClient} */ (
    getPublicClient(wagmiConfig, { chainId })
  );
  const [price, approval, migration] = await Promise.all([
    client.getGasPrice(),
    approved
      ? 0n
      : client.estimateContractGas({
          abi: ERC20Abi,
          account: owner,
          address: stableCoinAddress,
          args: [migrationContract, amount],
          functionName: "approve",
        }),
    approved
      ? client
          .estimateContractGas({
            abi: migrationABI,
            account: owner,
            address: migrationContract,
            args: [amount, recipient],
            functionName: "migrate",
          })
          .catch(() => MIGRATE_GAS_FALLBACK)
      : MIGRATE_GAS_FALLBACK,
  ]);

  return price * (approval + migration);
}

/**
 *  Migrates the approved amount to the given account
 *
 * @param {bigint} amount - the amount to be migrated
 * @param {number} chainId - the id of the smart contract
 * @param {string} mainnetDuskAddress - the wallet address where tokens should be migrated to
 * @param {`0x${string}`} migrationContract - the migration contract address
 * @param {`0x${string}`} [owner] - the account reviewed: it signs, or nothing does
 * @returns {Promise<`0x${string}`>} - The transaction hash.
 */
export const migrate = async (
  amount,
  chainId,
  mainnetDuskAddress,
  migrationContract,
  owner
) => {
  const { request } = await simulateContract(wagmiConfig, {
    abi: migrationABI,
    account: owner,
    address: migrationContract,
    args: [amount, mainnetDuskAddress],
    chainId: chainId,
    functionName: "migrate",
  });

  // Once the wallet was asked to send it, it may have gone out whatever went
  // wrong, but its own refusals (describeFailure).
  return await writeContract(wagmiConfig, request).catch((error) => {
    throw outcomeUnknown(error);
  });
};
