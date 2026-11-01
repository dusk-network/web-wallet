const storageKey = `${CONFIG.LOCAL_STORAGE_APP_KEY}-verified-names`;

/**
 * The names verified for the wallet's public accounts, by network and
 * account, as the browser keeps them.
 *
 * @returns {Record<string, string>}
 */
function readNames() {
  try {
    const names = JSON.parse(localStorage.getItem(storageKey) ?? "{}");

    return names && typeof names === "object" ? names : {};
  } catch {
    return {};
  }
}

/**
 * The `.dusk` name last verified for a public account on the network, kept
 * to show while a new lookup is pending or failing: "" for none.
 *
 * @param {string} network
 * @param {string} account
 * @returns {string}
 */
export function getVerifiedName(network, account) {
  const name = readNames()[`${network} ${account}`];

  return typeof name === "string" ? name : "";
}

/**
 * Keeps the outcome of a lookup that worked: the name, or that there is
 * none any more.
 *
 * @param {string} network
 * @param {string} account
 * @param {string} name
 */
export function keepVerifiedName(network, account, name) {
  const names = readNames();
  const key = `${network} ${account}`;

  if (name) {
    names[key] = name;
  } else {
    delete names[key];
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(names));
  } catch {
    // The name is still looked up each time.
  }
}

/** Forgets every name kept, as when the wallet is reset. */
export function forgetVerifiedNames() {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Nothing was kept.
  }
}

/**
 * Forgets the names kept for a removed wallet's public accounts, on every
 * network: another wallet's stay.
 *
 * @param {string[]} accounts
 */
export function forgetVerifiedNamesOf(accounts) {
  const own = new Set(accounts.map(String));
  const names = readNames();
  const kept = Object.fromEntries(
    Object.entries(names).filter(([key]) => !own.has(key.split(" ")[1]))
  );

  try {
    localStorage.setItem(storageKey, JSON.stringify(kept));
  } catch {
    // Nothing was kept.
  }
}
