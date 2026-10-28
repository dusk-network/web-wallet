<script>
  import { Button } from "$lib/dusk/components";
  import {
    connectionFailed,
    startWalletConnection,
    wasConnectedBefore,
  } from "$lib/web3/walletConnection";

  /**
   * The page inside, the Bridge or Migrate page, with the EVM wallet
   * connection: it starts when someone asks to connect a wallet, or as the
   * page opens when one was connected before, which the page then waits
   * for. Nothing of it runs on any other page.
   */
  let isReconnecting = false;

  function start() {
    isReconnecting = true;
    startWalletConnection()
      .catch(() => {})
      .finally(() => {
        isReconnecting = false;
      });
  }

  // Decided before the page shows, which then waits only for a wallet to
  // come back.
  if (wasConnectedBefore()) {
    start();
  }
</script>

{#if $connectionFailed}
  <div class="wallet-connection-gate" role="alert">
    <p>Couldn't load the EVM wallet connection. Check your connection.</p>
    <Button
      on:click={start}
      size="small"
      text="Try again"
      variant="secondary"
    />
  </div>
{:else if isReconnecting}
  <p class="wallet-connection-gate wallet-connection-gate--loading">
    Loading the EVM wallet connection…
  </p>
{:else}
  <slot />
{/if}

<style lang="postcss">
  .wallet-connection-gate {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    width: min(100%, 30rem);
    margin: 2rem auto;
    padding: 0 1rem;
    color: var(--calm-text);
  }

  .wallet-connection-gate--loading {
    color: var(--calm-muted);
  }
</style>
