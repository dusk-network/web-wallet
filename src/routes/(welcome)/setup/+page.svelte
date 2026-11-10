<svelte:options immutable={true} />

<script>
  import { version } from "$app/environment";
  import { AppAnchor, AppAnchorButton } from "$lib/components";
  import { settingsStore } from "$lib/stores";
  import { mdiKeyOutline, mdiRestore, mdiWalletOutline } from "@mdi/js";

  import PaymentAsked from "../PaymentAsked.svelte";

  // There is a wallet to unlock once one was created or restored here.
  const { userId } = $settingsStore;

  // SvelteKit's version is the commit built (svelte.config.js).
  const commit = version.slice(0, 8);

  /** Whether the request offers a wallet elsewhere on the phone first. */
  let offersElsewhere = false;
</script>

<section class="setup-content">
  <div class="setup-content__wrapper">
    <h2 class="h1 setup-heading">Dusk Web Wallet</h2>

    <!-- A link asking for a payment: what it asks, kept through the setup. -->
    <PaymentAsked
      bind:offersElsewhere
      next={userId
        ? "Unlock to pay it."
        : "Create or restore a wallet to pay it."}
    />

    <div class="setup-content__options">
      <!-- Coming back, unlocking comes first; a new wallet comes second. -->
      <div class="setup-content__options-group">
        {#if userId}
          <AppAnchorButton
            href="/unlock"
            text="Unlock"
            icon={{ path: mdiKeyOutline }}
          />
        {/if}
        <AppAnchorButton
          href="/setup/create"
          variant={userId || offersElsewhere ? "tertiary" : "primary"}
          text="Create new wallet"
          icon={{ path: mdiWalletOutline }}
        />
        <AppAnchorButton
          href="/setup/restore/"
          variant="tertiary"
          text="Restore wallet"
          icon={{ path: mdiRestore }}
        />
      </div>
    </div>
  </div>
</section>

<!-- To the build's manifest: every file's SHA-256, to check against the source. -->
<footer class="setup-footer">
  <AppAnchor
    href="/build-manifest.json"
    rel="noopener noreferrer"
    target="_blank"
    >Web Wallet v{import.meta.env.APP_VERSION} ({commit})</AppAnchor
  >
</footer>

<style lang="postcss">
  .setup-content {
    flex: 1;
    display: flex;
    flex-direction: column;

    &__wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    &__options {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;

      &-group {
        display: flex;
        flex-direction: column;
        gap: var(--default-gap);
      }
    }
  }

  .setup-heading {
    position: relative;
    max-width: 12ch;
  }

  .setup-footer {
    color: var(--muted-color);
    font-variant-numeric: tabular-nums;
    font-size: 0.75em;
    letter-spacing: 0.08em;

    & :global(.dusk-anchor) {
      color: inherit;
    }
  }
</style>
