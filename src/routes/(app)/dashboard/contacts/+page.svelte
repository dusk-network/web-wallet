<script>
  import { page } from "$app/stores";
  import { activityState } from "$lib/activity";
  import { contactsStore } from "$lib/contacts";
  import { ContactsView } from "$lib/containers/Contacts";
  import { appPath } from "$lib/containers/Shell";
  import { resolveDuskName } from "$lib/dusk-domains";
  import { goto } from "$lib/navigation";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";
  import { nodeBaseUrl } from "$lib/url";

  const { networkName } = $networkStore;

  /**
   * Names resolve through the wallet's own node, as in Send.
   *
   * @param {string} name
   */
  const resolveName = (name) =>
    resolveDuskName(name, networkName, nodeBaseUrl());

  /**
   * Opens a contact, its form or a new one, or closes it, in the address.
   *
   * @param {CustomEvent<{ edit: boolean, id: string | null }>} event
   */
  function select({ detail: { edit, id } }) {
    const next = new URL(url);

    next.searchParams.delete("contact");
    next.searchParams.delete("edit");

    if (id) {
      next.searchParams.set("contact", id);
    }

    if (id && edit) {
      next.searchParams.set("edit", "1");
    }

    goto(`${appPath(next.pathname)}${next.search}`, {
      keepFocus: true,
      noScroll: true,
      replaceState: true,
    });
  }

  $: ({ url } = $page);
  $: ({ language } = $settingsStore);
  $: ({ rows } = $activityState);
  $: own = $walletStore.profiles.flatMap((profile) => [
    String(profile.account),
    String(profile.address),
  ]);
</script>

<ContactsView
  contacts={$contactsStore}
  editing={url.searchParams.get("edit") === "1"}
  locale={language}
  on:select={select}
  {own}
  {resolveName}
  {rows}
  selected={url.searchParams.get("contact")}
/>
