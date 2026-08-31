/** @type {(transactions: Transaction[]) => Transaction[]} */
const sortByHeightDesc = (transactions) =>
  [...transactions].sort((a, b) =>
    a.block_height < b.block_height
      ? 1
      : a.block_height > b.block_height
        ? -1
        : 0
  );

export default sortByHeightDesc;
