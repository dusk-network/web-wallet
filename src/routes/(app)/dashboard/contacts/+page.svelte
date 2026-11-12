<script>
  import { page } from "$app/stores";
  import { ProfileGenerator } from "@dusk/w3sper";
  import { activityState } from "$lib/activity";
  import { verifiedNamesOf } from "$lib/activity/counterpartyNames";
  import { contactsStore } from "$lib/contacts";
  import { ContactsView } from "$lib/containers/Contacts";
  import { appPath } from "$lib/containers/Shell";
  import { resolveDuskName } from "$lib/dusk-domains";
  import { sheetStep } from "$lib/navigation";
  import { networkStore, settingsStore, walletStore } from "$lib/stores";
  import { profilesHere } from "$lib/wallets";
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
   * How many sheets an address has open: a contact, and its form over it.
   *
   * @param {URL} at
   */
  const sheetsAt = (at) =>
    Number(at.searchParams.has("contact")) +
    Number(at.searchParams.get("edit") === "1");

  /**
   * Opens a contact, its form or a new one, or closes it, in the address, each
   * a step of its own in the browser's history, so that Back closes it.
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

    sheetStep(
      `${appPath(next.pathname)}${next.search}`,
      sheetsAt(url),
      sheetsAt(next)
    );
  }

  /**
   * The verified .dusk names of the contacts' public accounts, as History
   * names its counterparties: one saved without a name is known by it too,
   * whether or not the history shown has paid it.
   *
   * @type {Map<string, string | null>}
   */
  let names = new Map();

  /** The accounts asked about last. */
  let asked = "";

  /** @param {Contact[]} contacts */
  function lookUpNames(contacts) {
    const accounts = contacts
      .filter(
        ({ address, duskName }) =>
          !duskName && ProfileGenerator.typeOf(address) === "account"
      )
      .map(({ address }) => address);
    const key = accounts.join("\n");

    if (key === asked) {
      return;
    }

    asked = key;
    verifiedNamesOf(accounts, {
      network: String(networkName),
      nodeUrl: nodeBaseUrl(),
    })
      .then((found) => {
        if (asked === key) {
          names = found;
        }
      })
      .catch(() => {});
  }

  $: ({ url } = $page);
  $: ({ language } = $settingsStore);
  $: ({ rows } = $activityState);
  $: lookUpNames($contactsStore);
  $: own = $walletStore.profiles.flatMap((profile) => [
    String(profile.account),
    String(profile.address),
  ]);
</script>

<ContactsView
  contacts={$contactsStore}
  editing={url.searchParams.get("edit") === "1"}
  locale={language}
  {names}
  on:select={select}
  {own}
  profiles={$profilesHere}
  {resolveName}
  {rows}
  selected={url.searchParams.get("contact")}
/>
