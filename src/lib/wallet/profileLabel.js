import { getVerifiedName } from "$lib/dusk-domains/verifiedNames";

/**
 * How the wallet names one of its profiles: "Profile 1", with the `.dusk`
 * name last verified for its public account on the network after it.
 *
 * @param {{ account: unknown }[]} profiles The wallet's profiles
 * @param {{ account: unknown } | null | undefined} profile
 * @param {string} network The network's name
 */
export default function profileLabel(profiles, profile, network) {
  const index = profile ? profiles.indexOf(profile) : -1;

  if (index < 0) {
    return "";
  }

  const name = getVerifiedName(network, String(profile?.account));

  return name ? `Profile ${index + 1} · ${name}` : `Profile ${index + 1}`;
}
