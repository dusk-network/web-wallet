import { redirect } from "@sveltejs/kit";
import { get } from "svelte/store";

import { cardRoutes, migrationRoutes } from "$lib/bridge/cardRoutes";
import nodeNetwork from "$lib/stores/nodeNetwork";

/**
 * Migrating is one of the Bridge's routes: this opens the Bridge on the
 * first migration into Dusk, BNB Smart Chain's where the network has one.
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
