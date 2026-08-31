/** @param {any} value @returns {value is Error} */
const isError = (value) =>
  Object.prototype.toString.call(value) === "[object Error]";

/** @type {(value: any) => Error} */
const getErrorFrom = (value) => {
  if (isError(value)) return value;
  if (value === null || value === undefined) return new Error("Unknown error");
  if (typeof value === "string") return new Error(value);
  if (typeof value?.message === "string") return new Error(value.message);
  return new Error(JSON.stringify(value));
};

export default getErrorFrom;
