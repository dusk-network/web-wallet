<script>
  // The app's layout with Send in it, as the app draws the page: anew for each
  // wallet that opens.
  import { Send } from "$lib/components";

  import Layout from "../+layout.svelte";

  /** @type {any} */
  export let send;
</script>

<Layout><Send {...send} /></Layout>
