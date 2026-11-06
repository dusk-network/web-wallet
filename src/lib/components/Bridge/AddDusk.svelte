<script>
  /**
   * "Add DUSK to <wallet>": for the connected EVM wallet that takes the
   * request, DUSK of a route's chain for it to show. Gone once the wallet
   * added it for that address and chain; a refusal says nothing.
   */
  import { Button } from "$lib/dusk/components";
  import {
    addDusk,
    addedKey,
    duskAdded,
    takesAddDusk,
  } from "$lib/web3/addDusk";
  import { account } from "$lib/web3/walletConnection";

  /**
   * The route's chain, as the network's file gives it, with its token.
   *
   * @type {{ chainId: number, token?: string, tokenLabel?: string }}
   */
  export let chain;

  /**
   * The address it's for, where it's one: offered only while that one is
   * connected.
   *
   * @type {string | null}
   */
  export let address = null;

  /** Whether the connected wallet takes the request. */
  let takes = false;

  let isAsking = false;

  /** @param {import("@wagmi/core").Connector | undefined} connector */
  async function check(connector) {
    takes = false;

    const answer = await takesAddDusk(connector);

    if (connector === $account.connector) {
      takes = answer;
    }
  }

  async function add() {
    isAsking = true;

    if (!(await addDusk(chain))) {
      // Still offered after a refusal, but not to a wallet that can't.
      await check(connector);
    }

    isAsking = false;
  }

  $: ({ address: connected, connector, isConnected } = $account);
  $: check(connector);
  $: isShown =
    Boolean(chain.token) &&
    isConnected &&
    Boolean(connected) &&
    takes &&
    (!address || address.toLowerCase() === connected?.toLowerCase()) &&
    !$duskAdded.includes(addedKey(chain.chainId, String(connected)));
</script>

{#if isShown}
  <Button
    className="add-dusk"
    disabled={isAsking}
    on:click={add}
    size="small"
    text={`Add DUSK to ${connector?.name || "your wallet"}`}
    variant="tertiary"
  />
{/if}
