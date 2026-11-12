import { getVerifiedName } from "$lib/dusk-domains/verifiedNames";
import { profileNameAt } from "$lib/wallets/directory";

/**
 * How the wallet names one of its profiles: the name it was given here, or
 * "Profile 1", with the `.dusk` name last verified for its public account
 * on the network after it.
 *
 * @param {{ account: unknown }[]} profiles The wallet's profiles
 * @param {{ account: unknown } | null | undefined} profile
 * @param {string} network The network's name
 * @param {string[]} [names] The names its profiles were given here
 */
export default function profileLabel(profiles, profile, network, names = []) {
  const index = profile ? profiles.indexOf(profile) : -1;

  if (index < 0) {
    return "";
  }

  const label = profileNameAt(names, index);
  const name = getVerifiedName(network, String(profile?.account));

  return name ? `${label} · ${name}` : label;
}

/**
 * How a profile is named in what leaves the wallet, as an export, as the
 * extension names it: by the `.dusk` name last verified for its public
 * account on the network, else the name it was given here, or "Profile 1".
 *
 * @param {{ account: unknown }[]} profiles The wallet's profiles
 * @param {{ account: unknown } | null | undefined} profile
 * @param {string} network The network's name
 * @param {string[]} [names] The names its profiles were given here
 */
export function profileOutsideName(profiles, profile, network, names = []) {
  const index = profile ? profiles.indexOf(profile) : -1;

  return index < 0
    ? ""
    : getVerifiedName(network, String(profile?.account)) ||
        profileNameAt(names, index);
}
