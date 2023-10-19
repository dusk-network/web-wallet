<script>
	import { mdiHome } from "@mdi/js";

	import { AnchorButton } from "$lib/dusk/components";
</script>

<section>
	<AnchorButton
		href="http://example.com"
		icon={{ path: mdiHome }}
		text="Anchor text"
	/>
	<AnchorButton
		disabled={true}
		href="http://example.com"
		icon={{ path: mdiHome }}
		text="Anchor text"
	/>
	<AnchorButton
		className="secondary"
		href="http://example.com"
		icon={{ path: mdiHome }}
		text="Anchor text"
	/>
	<AnchorButton
		className="secondary"
		disabled={true}
		href="http://example.com"
		icon={{ path: mdiHome }}
		text="Anchor text"
	/>
	<AnchorButton
		className="tertiary"
		href="http://example.com"
		icon={{ path: mdiHome }}
		text="Anchor text"
	/>
	<AnchorButton
		className="tertiary"
		disabled={true}
		href="http://example.com"
		icon={{ path: mdiHome }}
		text="Anchor text"
	/>
</section>
<section>
	<AnchorButton
		className="small"
		href="http://example.com"
		icon={{ path: mdiHome }}
		text="Anchor text"
	/>
	<AnchorButton
		className="small"
		disabled={true}
		href="http://example.com"
		icon={{ path: mdiHome }}
		text="Anchor text"
	/>
	<AnchorButton
		className="secondary small"
		href="http://example.com"
		icon={{ path: mdiHome }}
		text="Anchor text"
	/>
	<AnchorButton
		className="secondary small"
		disabled={true}
		href="http://example.com"
		icon={{ path: mdiHome }}
		text="Anchor text"
	/>
	<AnchorButton
		className="tertiary small"
		href="http://example.com"
		icon={{ path: mdiHome }}
		text="Anchor text"
	/>
	<AnchorButton
		className="tertiary small"
		disabled={true}
		href="http://example.com"
		icon={{ path: mdiHome }}
		text="Anchor text"
	/>
</section>
