<svelte:options immutable={true} />

<script>
  import "css-doodle";
  import Animation from "./Animation.svelte";
  import { AppAnchorButton } from "$lib/components";
  import { mdiKeyOutline, mdiRestore, mdiWalletOutline } from "@mdi/js";
</script>

<section class="setup-content">
  <div class="setup-content__wrapper">
    <h2 class="h1 setup-heading">
      Dusk Web Wallet
    </h2>

    <div class="setup-content__options">
      <div class="setup-content__options-group">
        <AppAnchorButton
          href="/setup/create"
          text="Create new wallet"
          icon={{ path: mdiWalletOutline }}
        />
        <AppAnchorButton
          href="/setup/restore/"
          variant="tertiary"
          text="Restore Wallet"
          icon={{ path: mdiRestore }}
        />
      </div>
      <Animation />
      <AppAnchorButton
        href="/unlock"
        text="Unlock Wallet"
        icon={{ path: mdiKeyOutline }}
      />
    </div>
  </div>
</section>

<footer class="setup-footer">
  <span
    >Web Wallet v{import.meta.env.APP_VERSION} ({import.meta.env
      .APP_BUILD_INFO})</span
  >
</footer>

<style lang="postcss">
  .setup-content {
    flex: 1;

    &__wrapper {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      height: 100%;
    }

    &__options {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 1.25rem;
      height: 100%;

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
    font-family: var(--mono-font-family);
    font-size: 0.75em;
    letter-spacing: 0.08em;
  }
</style>
