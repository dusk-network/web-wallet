<svelte:options immutable={true} />

<script>
  import { page } from "$app/stores";
  import { WelcomeShell } from "$lib/containers/Shell";

  const { error, status } = $page;
</script>

<WelcomeShell>
  <section class="error-message">
    <h2>Error - {status}</h2>
    <p>{error?.message ?? ""}</p>
  </section>
</WelcomeShell>

<style lang="postcss">
  .error-message {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
  }
</style>
