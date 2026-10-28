import { get } from "svelte/store";

import { cardRoutes, migrationRoutes } from "$lib/bridge/cardRoutes";
import { redirect } from "$lib/navigation";
import nodeNetwork from "$lib/stores/nodeNetwork";

/**
 * Migrating is one of the Bridge's routes: this opens the Bridge on the
 * first migration into Dusk that's running, BNB Smart Chain's where the
 * network has one, else on the Bridge's own first route.
 *
 * @type {import("./$types").PageLoad}
 */
export function load() {
  const [route] = migrationRoutes(cardRoutes(get(nodeNetwork)));

  redirect(
    307,
    route ? `/dashboard/bridge?route=${route.id}` : "/dashboard/bridge"
  );
}
