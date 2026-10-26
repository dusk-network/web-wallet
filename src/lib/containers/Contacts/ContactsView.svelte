<script>
  import { createEventDispatcher } from "svelte";
  import {
    mdiAccountPlusOutline,
    mdiCheckCircleOutline,
    mdiMagnify,
    mdiSendOutline,
  } from "@mdi/js";
  import { AnchorButton, Button, Icon } from "$lib/dusk/components";
  import { BalanceValue } from "$lib/components";
  import { removeContact } from "$lib/contacts";
  import {
    configuredBridgeContracts,
    shortAddress,
  } from "$lib/activity/present";
  import { addBasePath } from "$lib/navigation";

  import ContactDetail from "./ContactDetail.svelte";
  import ContactForm from "./ContactForm.svelte";
  import { initialOf, lastPayments } from "./contactPresent";

  /** @type {Contact[]} */
  export let contacts;

  /** @type {ActivityRow[]} */
  export let rows;

  /** @type {string} */
  export let locale;

  /**
   * The contact open, "new" for the form of a new one, or null.
   *
   * @type {string | null}
   */
  export let selected = null;

  /** Whether the open contact is being changed. */
  export let editing = false;

  /** @type {(name: string) => Promise<DuskNameResolution>} */
  export let resolveName;

  const dispatch = createEventDispatcher();
  const bridgeContracts = configuredBridgeContracts();

  let query = "";

  /**
   * @param {string | null} id
   * @param {boolean} [edit]
   */
  const select = (id, edit = false) => dispatch("select", { edit, id });

  /** @param {Contact} contact */
  const sendHref = (contact) =>
    addBasePath(`/dashboard/send?to=${encodeURIComponent(contact.address)}`);

  $: q = query.trim().toLowerCase();
  $: shown = q
    ? contacts.filter((contact) =>
        [contact.name, contact.duskName ?? "", contact.address].some((value) =>
          value.toLowerCase().includes(q)
        )
      )
    : contacts;
  $: payments = lastPayments(rows, { bridgeContracts, locale });
  $: open = contacts.find((contact) => contact.id === selected) ?? null;
  $: panel =
    selected === "new" ? "new" : open ? (editing ? "edit" : "detail") : null;
</script>

<div class="contacts" class:contacts--open={panel}>
  <section aria-labelledby="contacts-title" class="contacts__main">
    <header class="contacts__header">
      <h2 class="contacts__title" id="contacts-title">Contacts</h2>
      <Button
        icon={{ path: mdiAccountPlusOutline }}
        on:click={() => select("new")}
        text="New contact"
        variant="primary"
      />
    </header>
    <p class="contacts__note">Saved only on this device.</p>

    {#if contacts.length}
      <label class="contacts__search">
        <Icon path={mdiMagnify} />
        <input
          aria-label="Search contacts"
          bind:value={query}
          placeholder="Search names or addresses"
          type="search"
        />
      </label>
    {/if}

    {#if !contacts.length}
      <p class="contacts__empty">
        No contacts yet. Save one here, or from Send once a recipient is
        entered.
      </p>
    {:else if !shown.length}
      <p class="contacts__empty">No contact has "{query.trim()}".</p>
    {:else}
      <table class="contacts__table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th class="contacts__col-dusk" scope="col">.dusk name</th>
            <th class="contacts__col-type" scope="col">Type</th>
            <th class="contacts__col-address" scope="col">Address</th>
            <th class="contacts__col-last" scope="col">Last payment</th>
            <th class="contacts__col-send" scope="col"
              ><span class="sr-only">Send</span></th
            >
          </tr>
        </thead>
        <tbody>
          {#each shown as contact (contact.id)}
            {@const last = payments.get(contact.address)}
            <tr
              class="contacts__row"
              class:contacts__row--selected={contact.id === selected}
            >
              <td>
                <button
                  aria-expanded={contact.id === selected}
                  class="contacts__open"
                  on:click={() =>
                    select(contact.id === selected ? null : contact.id)}
                  type="button"
                >
                  <span aria-hidden="true" class="contacts__avatar"
                    >{initialOf(contact.name)}</span
                  >
                  <span class="contacts__who">
                    <span class="contacts__name">{contact.name}</span>
                    <span class="contacts__sub">
                      {#if last}
                        {last.verb}
                        <BalanceValue
                          exact={last.amount.exact}
                          value={last.amount.text}
                        /> DUSK · {last.day}
                      {:else}
                        {contact.duskName ?? shortAddress(contact.address)}
                      {/if}
                    </span>
                  </span>
                </button>
              </td>
              <td class="contacts__col-dusk">
                {#if contact.duskName}
                  <span class="contacts__dusk"
                    >{contact.duskName}
                    {#if contact.checkedAt}
                      <span
                        class="contacts__checked"
                        title="Pointed to this address when last checked"
                        ><Icon path={mdiCheckCircleOutline} /></span
                      >
                    {/if}</span
                  >
                {:else}
                  <span aria-label="None">—</span>
                {/if}
              </td>
              <td class="contacts__col-type">
                <span class="contacts__badge"
                  >{contact.type === "address" ? "Shielded" : "Public"}</span
                >
              </td>
              <td class="contacts__col-address">
                <code title={contact.address}
                  >{shortAddress(contact.address)}</code
                >
              </td>
              <td class="contacts__col-last">
                {#if last}
                  {last.verb}
                  <BalanceValue
                    exact={last.amount.exact}
                    value={last.amount.text}
                  /> DUSK · {last.day}
                {:else}
                  <span aria-label="None">—</span>
                {/if}
              </td>
              <td class="contacts__col-send">
                <AnchorButton
                  aria-label="Send to {contact.name}"
                  href={sendHref(contact)}
                  icon={{ path: mdiSendOutline }}
                  size="small"
                  text="Send"
                  variant="secondary"
                />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  {#if panel === "new"}
    <div class="contacts__panel">
      <ContactForm
        on:cancel={() => select(null)}
        on:saved={(event) => select(event.detail.id)}
        {resolveName}
      />
    </div>
  {:else if panel === "edit" && open}
    <div class="contacts__panel">
      {#key open.id}
        <ContactForm
          contact={open}
          on:cancel={() => select(open?.id ?? null)}
          on:delete={(event) => {
            removeContact(event.detail.id);
            select(null);
          }}
          on:saved={(event) => select(event.detail.id)}
          {resolveName}
        />
      {/key}
    </div>
  {:else if open}
    <div class="contacts__panel">
      <ContactDetail
        {bridgeContracts}
        contact={open}
        {locale}
        on:close={() => select(null)}
        on:edit={() => select(open?.id ?? null, true)}
        {resolveName}
        {rows}
      />
    </div>
  {/if}
</div>

<style lang="postcss">
  .contacts {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    flex: 1;
    width: 100%;

    &--open {
      grid-template-columns: minmax(0, 1fr) 28rem;
    }
  }

  .contacts__main {
    min-width: 0;
    padding: 2.25rem 3rem 3rem;
  }

  .contacts__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .contacts__title {
    font-size: 1.75rem;
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .contacts__note {
    margin-top: 0.375rem;
    color: var(--calm-muted);
    font-size: 0.84375rem;
  }

  .contacts__search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 28rem;
    height: 2.75rem;
    margin: 1.25rem 0 0.75rem;
    padding: 0 0.875rem;
    border-radius: 0.75rem;
    background: var(--calm-s1);
    color: var(--calm-muted);

    & :global(.dusk-icon) {
      width: 1.125rem;
      height: 1.125rem;
    }

    & input {
      all: unset;
      flex: 1;
      min-width: 0;
      color: var(--calm-text);
      font-size: 0.9375rem;
    }

    &:focus-within {
      outline: 2px solid var(--calm-focus);
    }
  }

  .contacts__empty {
    margin-top: 2rem;
    color: var(--calm-muted);
  }

  .contacts__table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;

    & th {
      padding: 0.625rem 0.75rem;
      border-bottom: 1px solid var(--calm-line2);
      color: var(--calm-muted);
      font-weight: 400;
      text-align: left;
    }

    & td {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--calm-line);
      vertical-align: middle;
    }
  }

  .contacts__row--selected {
    background: var(--calm-s1);
  }

  .contacts__open {
    all: unset;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 44px;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--calm-focus);
      outline-offset: 2px;
      border-radius: 0.5rem;
    }
  }

  .contacts__avatar {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    background: var(--calm-s2);
    font-weight: 500;
  }

  .contacts__who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .contacts__name {
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .contacts__sub {
    display: none;
    color: var(--calm-muted);
    font-size: 0.8125rem;
  }

  .contacts__dusk {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }

  .contacts__checked :global(.dusk-icon) {
    width: 1rem;
    height: 1rem;
    color: var(--calm-online);
  }

  .contacts__badge {
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: var(--calm-s2);
    font-size: 0.78125rem;
  }

  .contacts__col-address code {
    color: var(--calm-muted);
    font-family: var(--code-font-family);
    font-size: 0.8125rem;
    white-space: nowrap;
  }

  /* With a contact open beside it, the list leaves its kind and address to
     the panel on all but wide screens. */
  @media (max-width: 89.99rem) {
    .contacts--open .contacts__col-type,
    .contacts--open .contacts__col-address {
      display: none;
    }
  }

  .contacts__col-send {
    text-align: right;
  }

  .contacts__panel {
    position: sticky;
    top: var(--header-height);
    align-self: start;
    height: calc(100vh - var(--header-height));
    overflow-y: auto;
    border-left: 1px solid var(--calm-line2);
    background: var(--calm-panel);
  }

  /* Narrow screens: the panel over the list, as a page of its own. */
  @media (max-width: 63.99rem) {
    .contacts--open {
      grid-template-columns: minmax(0, 1fr);
    }

    .contacts__panel {
      position: fixed;
      inset: var(--header-height) 0 0;
      z-index: 11;
      height: auto;
      border-left: 0 none;
    }

    .contacts__main {
      padding: 1.75rem 1.5rem 2rem;
    }

    .contacts__col-type,
    .contacts__col-address {
      display: none;
    }
  }

  /* Phones: the name with its last payment, and Send. */
  @media (max-width: 47.99rem) {
    .contacts__main {
      padding: 1rem 1rem 1.5rem;
    }

    .contacts__col-dusk,
    .contacts__col-last {
      display: none;
    }

    /* Still read out, not shown. */
    .contacts__table thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .contacts__sub {
      display: block;
    }

    .contacts__table td {
      padding: 0.5rem 0.25rem;
    }
  }
</style>
