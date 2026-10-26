<script>
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/stores";
  import { appPath } from "$lib/containers/Shell";

  /** Pages laid out across the window; the others are one column. */
  const WIDE = new Set([
    "/dashboard",
    "/dashboard/contacts",
    "/dashboard/transactions",
  ]);

  const scrollToTop = () => window.scrollTo(0, 0);

  // A new page, or a flow's next step, starts at the top. A panel opened or
  // closed on the page, a query of its own, keeps the place in its list:
  // only the page's path, or the flow it shows, makes it a new page.
  afterNavigate(({ from, to }) => {
    const isSamePage =
      from?.url.pathname === to?.url.pathname &&
      from?.url.searchParams.get("flow") === to?.url.searchParams.get("flow");

    if (!isSamePage) {
      scrollToTop();
    }
  });

  $: ({ url } = $page);
</script>

<svelte:window
  on:beforeunload={(event) => {
    event.preventDefault();
  }}
/>

<section
  class="dashboard"
  class:dashboard--column={!WIDE.has(appPath(url.pathname))}
  on:wizardstepchange={scrollToTop}
>
  <h2 class="sr-only">Dashboard</h2>
  <slot />
</section>

<style lang="postcss">
  :global {
    .dashboard {
      position: relative;
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 1rem;
      width: 100%;
    }

    /* A flow: one column, centred, with room around it. */
    .dashboard--column {
      width: min(100%, 44rem);
      margin: 0 auto;
      padding: 2rem 1.5rem 0;
    }

    /*
     * A flow's card is the page itself: no surface of its own, its heading
     * the page's title, and its buttons on the window's surface.
     */
    .dashboard--column > .dusk-card {
      padding: 0;
      background: none;

      & > .dusk-card__header-container {
        padding: 0 0 0.5rem;
      }

      & > .dusk-card__body-container {
        padding: 0.5rem 0 0;
      }

      & .dusk-card__heading-container h3 {
        font-size: 1.75rem;
        font-weight: 500;
      }

      & .dusk-card__heading-icons {
        display: none;
      }

      & .dusk-wizard__step-navigation {
        background: var(--calm-s0);
      }
    }

    @media (max-width: 47.99rem) {
      .dashboard--column {
        padding: 1rem 1rem 0;
      }

      .dashboard--column > .dusk-card .dusk-card__heading-container h3 {
        font-size: 1.375rem;
      }
    }
  }
</style>
