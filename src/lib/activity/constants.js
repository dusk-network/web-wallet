/** What a transaction did, as the history names it. */
export { ENTRY_KIND as TX_KIND } from "@dusk-network/app-core/history";

/**
 * Where the wallet keeps one of its own transactions that History doesn't
 * show, as the node doesn't have it: asked to broadcast it, the node hasn't
 * answered yet, or it doesn't have it, its nonce still free. It's the status
 * `@dusk-network/app-core/activity` calls dropped: its row isn't shown.
 *
 * @type {import("@dusk-network/app-core/activity").SendStatus}
 */
export const NOT_SHOWN = "removed";

/**
 * This page's name for the transactions it hands to the node: one kept
 * unseen under another page's name, which went before the node answered,
 * never had its hand-over finish, and may have gone out.
 */
export const THIS_PAGE = crypto.randomUUID();
