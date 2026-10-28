/**
 * Used to shorten a string by replacing the middle with an ellipsis.
 * @param {String} originalString
 * @param {Number} charactersToDisplay
 * @param {String} [ellipsis="…"] What replaces the middle.
 * @returns {String}
 */
function middleEllipsis(originalString, charactersToDisplay, ellipsis = "…") {
  if (originalString.length <= 2 * charactersToDisplay) {
    return originalString;
  }

  return `${originalString.substring(
    0,
    charactersToDisplay
  )}${ellipsis}${originalString.substring(originalString.length - charactersToDisplay)}`;
}

export default middleEllipsis;
