<script>
	import { mdiHome } from "@mdi/js";

	import { Button } from "$lib/dusk/components";
</script>

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
		className="small"
		icon={{ path: mdiHome }}
		text="Some text"
	/>
	<Button
		className="small"
		disabled={true}
		icon={{ path: mdiHome }}
		text="Some text"
	/>
	<Button
		className="secondary small"
		icon={{ path: mdiHome }}
		text="Some text"
	/>
	<Button
		className="secondary small"
		disabled={true}
		icon={{ path: mdiHome }}
		text="Some text"
	/>
	<Button
		className="tertiary small"
		icon={{ path: mdiHome }}
		text="Some text"
	/>
	<Button
		className="tertiary small"
		disabled={true}
		icon={{ path: mdiHome }}
		text="Some text"
	/>
</section>

<section>
	<Button
		variant="text"
		icon={{ path: mdiHome }}
		text="Some text"
	/>
	<Button
		variant="text"
		disabled={true}
		icon={{ path: mdiHome }}
		text="Some text"
	/>
</section>
