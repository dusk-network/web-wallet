<svelte:options immutable={true}/>

<script>
	import { mdiHome } from "@mdi/js";
	import {
		AnchorButton,
		Button,
		Select,
		Textbox,
		Throbber
	} from "$lib/dusk/components";

	const someOptions = ["apple", "banana", "lemon", "a really big orange", "pear"];
</script>

<main>
	<h1>COMPONENTS SHOWCASE</h1>
	<section>
		<Button
			icon={{ path: mdiHome }}
			tabindex=""
			text="Some text"
		/>
		<Button
			disabled={true}
			icon={{ path: mdiHome }}
			tabindex=""
			text="Some text"
		/>
		<Button
			className="secondary"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Some text"
		/>
		<Button
			className="secondary"
			disabled={true}
			icon={{ path: mdiHome }}
			tabindex=""
			text="Some text"
		/>
		<Button
			className="tertiary"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Some text"
		/>
		<Button
			className="tertiary"
			disabled={true}
			icon={{ path: mdiHome }}
			tabindex=""
			text="Some text"
		/>
	</section>
	<section>
		<Button
			icon={{ path: mdiHome }}
			tabindex=""
		/>
		<Button
			disabled={true}
			icon={{ path: mdiHome }}
			tabindex=""
		/>
		<Button
			className="secondary"
			icon={{ path: mdiHome }}
			tabindex=""
		/>
		<Button
			className="secondary"
			disabled={true}
			icon={{ path: mdiHome }}
			tabindex=""
		/>
		<Button
			className="tertiary"
			icon={{ path: mdiHome }}
			tabindex=""
		/>
		<Button
			className="tertiary"
			disabled={true}
			icon={{ path: mdiHome }}
			tabindex=""
		/>
	</section>
	<section>
		<Button
			className="small"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Some text"
		/>
		<Button
			className="small"
			disabled={true}
			icon={{ path: mdiHome }}
			tabindex=""
			text="Some text"
		/>
		<Button
			className="secondary small"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Some text"
		/>
		<Button
			className="secondary small"
			disabled={true}
			icon={{ path: mdiHome }}
			tabindex=""
			text="Some text"
		/>
		<Button
			className="tertiary small"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Some text"
		/>
		<Button
			className="tertiary small"
			disabled={true}
			icon={{ path: mdiHome }}
			tabindex=""
			text="Some text"
		/>
	</section>
	<section>
		<Button
			className="small"
			icon={{ path: mdiHome }}
			tabindex=""
		/>
		<Button
			className="small"
			disabled={true}
			icon={{ path: mdiHome }}
			tabindex=""
		/>
		<Button
			className="secondary small"
			icon={{ path: mdiHome }}
			tabindex=""
		/>
		<Button
			className="secondary small"
			disabled={true}
			icon={{ path: mdiHome }}
			tabindex=""
		/>
		<Button
			className="tertiary small"
			icon={{ path: mdiHome }}
			tabindex=""
		/>
		<Button
			className="tertiary small"
			disabled={true}
			icon={{ path: mdiHome }}
			tabindex=""
		/>
	</section>
	<section>
		<AnchorButton
			href="http://example.com"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Anchor text"
		/>
		<AnchorButton
			disabled={true}
			href="http://example.com"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Anchor text"
		/>
		<AnchorButton
			className="secondary"
			href="http://example.com"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Anchor text"
		/>
		<AnchorButton
			className="secondary"
			disabled={true}
			href="http://example.com"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Anchor text"
		/>
		<AnchorButton
			className="tertiary"
			href="http://example.com"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Anchor text"
		/>
		<AnchorButton
			className="tertiary"
			disabled={true}
			href="http://example.com"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Anchor text"
		/>
	</section>
	<section>
		<AnchorButton
			className="small"
			href="http://example.com"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Anchor text"
		/>
		<AnchorButton
			className="small"
			disabled={true}
			href="http://example.com"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Anchor text"
		/>
		<AnchorButton
			className="secondary small"
			href="http://example.com"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Anchor text"
		/>
		<AnchorButton
			className="secondary small"
			disabled={true}
			href="http://example.com"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Anchor text"
		/>
		<AnchorButton
			className="tertiary small"
			href="http://example.com"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Anchor text"
		/>
		<AnchorButton
			className="tertiary small"
			disabled={true}
			href="http://example.com"
			icon={{ path: mdiHome }}
			tabindex=""
			text="Anchor text"
		/>
	</section>
	<section>
		<Select options={someOptions} tabindex=""/>
		<Select disabled={true} options={someOptions} tabindex=""/>
		<Textbox tabindex="" value="Some text here"/>
		<Textbox tabindex="" placeholder="placeholder text"/>
		<Textbox disabled={true} tabindex="" value="Some text here"/>
		<Textbox disabled={true} tabindex="" placeholder="placeholder text"/>
		<Throbber/>
	</section>
</main>

<style lang="postcss">
	main {
		overflow-y: auto;
	}

	main > section {
		display: flex;
		align-items: center;
		justify-content: space-around;
		flex-wrap: wrap;
		gap: 1em;
		margin: 1.5em 0;
	}
</style>
