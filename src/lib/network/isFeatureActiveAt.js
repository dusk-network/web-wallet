/** @type {(value: unknown) => value is number} */
const isHeight = (value) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * Tells if a feature in the `vm_config.features` of a node's info
 * is active at the given block height.
 *
 * A feature is active from its activation height on, or inside one of
 * its `[start, end]` height ranges, both ends included. Names match
 * regardless of case. A missing or unreadable feature isn't active.
 *
 * Heights arrive as JSON numbers, so u64::MAX, which means "never",
 * reads as 2^64: still above any height a block can have.
 *
 * @param {unknown} features
 * @param {string} name
 * @param {bigint} height
 * @returns {boolean}
 */
function isFeatureActiveAt(features, name, height) {
  if (!features || typeof features !== "object") {
    return false;
  }

  const upperCaseName = name.toUpperCase();
  const key = Object.keys(features).find(
    (featureName) => featureName.toUpperCase() === upperCaseName
  );

  if (key === undefined) {
    return false;
  }

  const activation = /** @type {Record<string, unknown>} */ (features)[key];
  const blockHeight = Number(height);

  if (isHeight(activation)) {
    return blockHeight >= activation;
  }

  return (
    Array.isArray(activation) &&
    activation.some(
      (range) =>
        Array.isArray(range) &&
        range.length === 2 &&
        isHeight(range[0]) &&
        isHeight(range[1]) &&
        blockHeight >= range[0] &&
        blockHeight <= range[1]
    )
  );
}

export default isFeatureActiveAt;
