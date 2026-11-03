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
