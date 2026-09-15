<script>
  import { onMount } from "svelte";

  import { logout, startInactivityTimer } from "$lib/navigation";

  onMount(() => startInactivityTimer(() => logout(false)));
</script>

<slot />
