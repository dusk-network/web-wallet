<script>
  import { WalletConnectionGate } from "$lib/components";
</script>

<!-- The bridge's pages, and only they, start the EVM wallet connection. -->
<WalletConnectionGate>
  <slot />
</WalletConnectionGate>
