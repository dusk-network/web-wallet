import {
  mdiArrowBottomLeft,
  mdiArrowTopRight,
  mdiCodeBraces,
  mdiEyeOffOutline,
  mdiLayersOutline,
  mdiSwapHorizontal,
  mdiSync,
} from "@mdi/js";

/**
 * The icon of each kind of row: what it did, never who it was with.
 *
 * @type {Record<import("$lib/activity/present").ActivityIcon, string>}
 */
export const ACTIVITY_ICONS = {
  bridge: mdiSwapHorizontal,
  call: mdiCodeBraces,
  received: mdiArrowBottomLeft,
  self: mdiSync,
  sent: mdiArrowTopRight,
  shield: mdiEyeOffOutline,
  staking: mdiLayersOutline,
};
