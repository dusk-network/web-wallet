import { Gas } from "@dusk/w3sper";

import { getBlocklistedRecipient } from "$lib/security/addressBlocklist";
import { walletStore } from "$lib/stores";

/**
 * Sends a transfer, with the `.dusk` name it goes to, if any, for the
 * history.
 *
 * @type {(to: string, amount: bigint, memo: string, gasPrice: bigint, gasLimit: bigint, toName?: string) => Promise<string>}
 */
const executeSend = (...args) => {
  const [to, amount, memo, gasPrice, gasLimit, toName] = args;
  const blocked = getBlocklistedRecipient(to);

  if (blocked) {
    return Promise.reject(new Error(blocked.reason));
  }

  return walletStore
    .transfer(
      to,
      amount,
      memo,
      new Gas({
        limit: gasLimit,
        price: gasPrice,
      }),
      { toName }
    )
    .then(({ hash }) => hash);
};

export default executeSend;
