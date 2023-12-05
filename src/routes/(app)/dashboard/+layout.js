/** @type {import('./$types').LayoutLoad} */
export async function load ({ fetch }) {
	const res = await fetch("https://api.dusk.network/v1/quote");
	const duskInfo = await res.json();

	// Temp
	const keys = ["2087290d3dc213d43e493f03f5435f99",
		"ffbee869aca5ff5ee13c2706e5d9779d",
		"06527a34e1c91fc5785ea7764a0c34b1",
		"f62d307103ca54516b29fcedd5463d16"];

	const currentKey = keys[0];

	return {
		currentKey,
		currentPrice: duskInfo.market_data.current_price,
		keys

	};
}
