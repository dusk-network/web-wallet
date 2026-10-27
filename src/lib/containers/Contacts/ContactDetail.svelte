<script>
  import { createEventDispatcher, onMount } from "svelte";
  import {
    mdiAlertCircleOutline,
    mdiCheckCircleOutline,
    mdiClose,
    mdiContentCopy,
    mdiPencilOutline,
    mdiSendOutline,
  } from "@mdi/js";
  import { AnchorButton, Button, Icon } from "$lib/dusk/components";
  import { toast } from "$lib/dusk/components/Toast/store";
  import { FullAddress } from "$lib/components";
  import {
    contactNamesOf,
    contactsStore,
    findContact,
    markContactNameChecked,
    markContactNameMoved,
    saveContact,
  } from "$lib/contacts";
  import { sozuPools } from "$lib/sozu";
  import { addBasePath } from "$lib/navigation";

  import ActivityRowItem from "../Home/ActivityRowItem.svelte";
  import { activityWith, checkedLabel, pointedAddress } from "./contactPresent";

  /** @type {Contact} */
  export let contact;

  /** @type {ActivityRow[]} */
  export let rows;

  /** @type {string} */
  export let locale;

  /** @type {Set<string> | undefined} */
  export let bridgeContracts = undefined;

  /** @type {(name: string) => Promise<DuskNameResolution>} */
  export let resolveName;

  const dispatch = createEventDispatcher();

  /** @type {HTMLButtonElement} */
  let closeButton;

  /**
   * What the check of the contact's `.dusk` name found.
   *
   * @type {{ state: "checking" } | { state: "same" } | { state: "failed" } | { address: string, state: "moved" } | null}
   */
  let check = null;

  /** Whether the user asked to take the address the name points to now. */
  let isTakingNew = false;

  /** The contact that has the new address already, if the user tried it. */
  let takenBy = "";

  /**
   * What makes a contact the one checked: not when it was checked.
   *
   * @param {Contact} c
   */
  const keyOf = (c) => [c.id, c.address, c.duskName ?? ""].join("\n");

  /**
   * Checks that the contact's `.dusk` name still points to its address, and
   * notes when it did. A check for a contact changed since is dropped.
   */
  async function checkName() {
    const checked = contact;
    const key = keyOf(checked);

    if (!checked.duskName) {
      check = null;
      return;
    }

    check = { state: "checking" };
    isTakingNew = false;
    takenBy = "";

    const resolution = await resolveName(checked.duskName).catch(() => null);

    if (keyOf(contact) === key) {
      check = checkOutcome(checked, resolution);
    }
  }

  /**
   * What a check found, noted on the contact when its name still points to
   * its address.
   *
   * @param {Contact} checked
   * @param {DuskNameResolution | null} resolution
   * @returns {NonNullable<typeof check>}
   */
  function checkOutcome(checked, resolution) {
    const pointed = resolution ? pointedAddress(checked, resolution) : null;

    if (!resolution || resolution.error === "lookup-failed") {
      return { state: "failed" };
    }

    if (pointed === checked.address) {
      markContactNameChecked(checked);

      return { state: "same" };
    }

    markContactNameMoved(checked, pointed ?? "");

    return { address: pointed ?? "", state: "moved" };
  }

  /**
   * Takes the address the contact's name points to now, unless another
   * contact has it: one address, one contact.
   *
   * @param {string} address
   */
  function takeNewAddress(address) {
    const other = findContact(address);

    if (other && other.id !== contact.id) {
      takenBy = other.name;

      return;
    }

    saveContact({ ...contact, address, checkedAt: Date.now() });
    toast(
      "success",
      `${contact.name} now has the new address`,
      mdiCheckCircleOutline
    );
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(contact.address);
      toast("success", "Address copied", mdiContentCopy);
    } catch {
      toast("error", "Couldn't copy the address", mdiAlertCircleOutline);
    }
  }

  $: activity = activityWith(rows, contact.address, {
    bridgeContracts,
    contactNames: contactNamesOf($contactsStore),
    locale,
    sozuPools: $sozuPools,
  }).slice(0, 5);
  $: kind = contact.type === "address" ? "Shielded" : "Public";
  $: checkedAt = contact.checkedAt;

  // A new contact, or the same one changed, is checked again; noting when
  // it was checked is no change.
  $: checkKey = keyOf(contact);
  $: if (checkKey) {
    void checkName();
  }

  onMount(() => {
    closeButton?.focus();
  });
</script>

<aside aria-labelledby="contact-detail-title" class="contact-detail">
  <header class="contact-detail__header">
    <span aria-hidden="true" class="contact-detail__avatar"
      >{Array.from(contact.name.trim())[0]?.toLocaleUpperCase() ?? "?"}</span
    >
    <div class="contact-detail__who">
      <h2 id="contact-detail-title">{contact.name}</h2>
      <p class="contact-detail__sub">
        {#if contact.duskName}<span>{contact.duskName}</span>{/if}
        <span class="contact-detail__badge">{kind}</span>
      </p>
    </div>
    <button
      aria-label="Close the contact"
      bind:this={closeButton}
      class="contact-detail__close"
      on:click={() => dispatch("close")}
      type="button"
    >
      <Icon path={mdiClose} />
    </button>
  </header>

  <div class="contact-detail__actions">
    <Button
      icon={{ path: mdiPencilOutline }}
      on:click={() => dispatch("edit")}
      text="Edit"
      variant="secondary"
    />
    <AnchorButton
      href={addBasePath(
        `/dashboard/send?to=${encodeURIComponent(contact.address)}`
      )}
      icon={{ path: mdiSendOutline }}
      text="Send"
      variant="primary"
    />
  </div>

  <section class="contact-detail__address">
    <h3>
      {contact.type === "address" ? "Shielded address" : "Public account"}
    </h3>
    <p class="contact-detail__code">
      <FullAddress address={contact.address} />
    </p>
    <div class="contact-detail__check">
      {#if check?.state === "same" && checkedAt}
        <p class="contact-detail__note contact-detail__note--checked">
          <Icon path={mdiCheckCircleOutline} />
          <span
            >{contact.duskName} still points to this address. Checked {checkedLabel(
              checkedAt,
              locale
            )}.</span
          >
        </p>
      {:else if check?.state === "checking"}
        <p class="contact-detail__note">Checking {contact.duskName}…</p>
      {:else if check?.state === "failed"}
        <p class="contact-detail__note">
          Couldn't check {contact.duskName}.
          <button
            class="contact-detail__link"
            on:click={() => checkName()}
            type="button">Try again</button
          >
        </p>
      {:else if check?.state === "moved"}
        {@const newAddress = check.address}
        <div class="contact-detail__warning" role="alert">
          <p>
            <strong
              >{contact.duskName} now points to {newAddress
                ? "another address"
                : "no address of this kind"}.</strong
            >
            This contact keeps the address saved here, and Send uses it.
          </p>
          {#if newAddress}
            {#if isTakingNew}
              <p class="contact-detail__code">
                <FullAddress address={newAddress} />
              </p>
              <div class="contact-detail__confirm">
                <Button
                  on:click={() => {
                    isTakingNew = false;
                  }}
                  text="Keep the saved one"
                  variant="secondary"
                />
                <Button
                  on:click={() => takeNewAddress(newAddress)}
                  text="Use the new address"
                  variant="primary"
                />
              </div>
              {#if takenBy}
                <p class="contact-detail__taken">
                  This address is already saved as {takenBy}.
                </p>
              {/if}
            {:else}
              <button
                class="contact-detail__link"
                on:click={() => {
                  isTakingNew = true;
                }}
                type="button">See the new address</button
              >
            {/if}
          {/if}
        </div>
      {/if}
      <Button
        className="contact-detail__copy"
        icon={{ path: mdiContentCopy }}
        on:click={copyAddress}
        size="small"
        text="Copy address"
        variant="secondary"
      />
    </div>
  </section>

  <section class="contact-detail__activity">
    <header class="contact-detail__activity-header">
      <h3>Activity with {contact.name}</h3>
      <a href={addBasePath("/dashboard/transactions")}>History</a>
    </header>
    {#if activity.length}
      <ul>
        {#each activity as { presentation, row } (row.hash)}
          <li><ActivityRowItem {locale} {presentation} {row} /></li>
        {/each}
      </ul>
    {:else}
      <p class="contact-detail__note">
        No payments with {contact.name} in your history yet.
      </p>
    {/if}
  </section>
</aside>

<style lang="postcss">
  .contact-detail {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: 0;
    padding: 1.5rem;
    background: var(--calm-panel);
  }

  .contact-detail__header {
    display: flex;
    align-items: center;
    gap: 0.875rem;

    & h2 {
      font-size: 1.375rem;
      font-weight: 500;
      overflow-wrap: anywhere;
    }
  }

  .contact-detail__avatar {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 50%;
    background: var(--calm-s2);
    font-size: 1.25rem;
    font-weight: 500;
  }

  .contact-detail__who {
    flex: 1;
    min-width: 0;
  }

  .contact-detail__sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.25rem;
    color: var(--calm-muted);
    font-size: 0.875rem;
  }

  .contact-detail__badge {
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: var(--calm-s2);
    color: var(--calm-text);
    font-size: 0.78125rem;
  }

  .contact-detail__close {
    all: unset;
    display: grid;
    place-items: center;
    align-self: flex-start;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: var(--calm-muted);
    cursor: pointer;

    &:hover {
      color: var(--calm-text);
    }

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
    }
  }

  .contact-detail__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.625rem;

    & > :global(*) {
      flex: 1 1 auto;
    }
  }

  .contact-detail__address,
  .contact-detail__activity {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;

    & h3 {
      color: var(--calm-muted);
      font-size: 0.875rem;
      font-weight: 400;
    }
  }

  .contact-detail__code {
    padding: 0.75rem 0.875rem;
    border-radius: 0.75rem;
    background: var(--calm-s1);
  }

  .contact-detail__check {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.625rem;
  }

  .contact-detail__note {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.375rem;
    color: var(--calm-text);
    font-size: 0.875rem;

    & :global(.dusk-icon) {
      flex: 0 0 auto;
      width: 1rem;
      height: 1rem;
      color: var(--calm-online);
    }
  }

  /* The mark stays beside its line, however it wraps. */
  .contact-detail__note--checked {
    align-items: flex-start;
    flex-wrap: nowrap;

    & :global(.dusk-icon) {
      margin-top: 0.125rem;
    }
  }

  .contact-detail__warning {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    width: 100%;
    padding: 0.75rem 0.875rem;
    border: 1px solid var(--calm-pending);
    border-radius: 0.75rem;
    font-size: 0.875rem;
  }

  .contact-detail__taken {
    color: var(--calm-danger);
  }

  .contact-detail__confirm {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .contact-detail__link {
    all: unset;
    color: var(--calm-text);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
    }
  }

  .contact-detail__activity-header {
    display: flex;
    align-items: center;
    justify-content: space-between;

    & a {
      color: var(--calm-muted);
      font-size: 0.84375rem;
    }
  }

  .contact-detail__activity ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
