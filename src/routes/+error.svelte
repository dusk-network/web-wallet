<svelte:options immutable={true} />

<script>
  import { page } from "$app/stores";
  import { AppAnchorButton } from "$lib/components";
  import { WelcomeShell } from "$lib/containers/Shell";

  const { error, status } = $page;
</script>

<WelcomeShell>
  <section class="error-message">
    <h2>Error - {status}</h2>
    <p>{error?.message ?? ""}</p>
    <AppAnchorButton
      className="error-message__home"
      data-sveltekit-replacestate
      href="/"
      text="Home"
    />
  </section>
</WelcomeShell>

<style lang="postcss">
  .error-message {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--small-gap);
    width: 100%;
  }

  :global(.error-message__home) {
    margin-top: var(--small-gap);
  }
</style>
