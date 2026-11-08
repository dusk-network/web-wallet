<script>
  /**
   * "Add DUSK to <wallet>": for the connected EVM wallet that takes the
   * request, DUSK of a route's chain for it to show. Once the wallet added it
   * for that address and chain, it says so in its place; a refusal says
   * nothing.
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

  /** The wallet it was just added to, by name, for as long as it's connected. */
  /** @type {{ key: string, name: string } | null} */
  let done = null;

  /** @param {import("@wagmi/core").Connector | undefined} connector */
  async function check(connector) {
    takes = false;

    const answer = await takesAddDusk(connector);

    if (connector === $account.connector) {
      takes = answer;
    }
  }

  async function add() {
    const name = connector?.name || "your wallet";
    const key = addedKey(chain.chainId, String(connected));

    isAsking = true;

    if (await addDusk(chain)) {
      done = { key, name };
    } else {
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
  $: isDone =
    isConnected && done?.key === addedKey(chain.chainId, String(connected));
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
{:else if isDone}
  <p class="add-dusk add-dusk--done" role="status">
    DUSK added to {done?.name}.
  </p>
{/if}

<style lang="postcss">
  .add-dusk--done {
    font-size: 0.875rem;
  }
</style>
