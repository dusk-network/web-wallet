<script>
  import { onMount } from "svelte";
  import { Button } from "$lib/dusk/components";
  import { startWalletConnection } from "$lib/web3/walletConnection";

  /**
   * The EVM wallet connection, started for the page inside: the Bridge and
   * Migrate pages. Nothing of it runs on any other page.
   *
   * @type {"failed" | "ready" | "starting"}
   */
  let state = "starting";

  function start() {
    state = "starting";
    startWalletConnection().then(
      () => {
        state = "ready";
      },
      () => {
        state = "failed";
      }
    );
  }

  onMount(start);
</script>

{#if state === "ready"}
  <slot />
{:else if state === "failed"}
  <div class="wallet-connection-gate" role="alert">
    <p>Couldn't load the EVM wallet connection. Check your connection.</p>
    <Button
      on:click={start}
      size="small"
      text="Try again"
      variant="secondary"
    />
  </div>
{:else}
  <p class="wallet-connection-gate wallet-connection-gate--loading">
    Loading the EVM wallet connection…
  </p>
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
