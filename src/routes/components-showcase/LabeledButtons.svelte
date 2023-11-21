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
		icon={{ path: mdiHome }}
		tabindex=""
		text="Some text"
		variant="secondary"
	/>
	<Button
		disabled={true}
		icon={{ path: mdiHome }}
		tabindex=""
		text="Some text"
		variant="secondary"
	/>
	<Button
		icon={{ path: mdiHome }}
		tabindex=""
		text="Some text"
		variant="tertiary"
	/>
	<Button
		disabled={true}
		icon={{ path: mdiHome }}
		tabindex=""
		text="Some text"
		variant="tertiary"
	/>
</section>
<section>
	<Button
		icon={{ path: mdiHome }}
		size="small"
		text="Some text"
	/>
	<Button
		disabled={true}
		icon={{ path: mdiHome }}
		size="small"
		text="Some text"
	/>
	<Button
		icon={{ path: mdiHome }}
		text="Some text"
		size="small"
		variant="secondary"
	/>
	<Button
		disabled={true}
		icon={{ path: mdiHome }}
		text="Some text"
		size="small"
		variant="secondary"
	/>
	<Button
		icon={{ path: mdiHome }}
		size="small"
		text="Some text"
		variant="tertiary"
	/>
	<Button
		disabled={true}
		icon={{ path: mdiHome }}
		size="small"
		text="Some text"
		variant="tertiary"
	/>
</section>

<section>
	<Button
		icon={{ path: mdiHome }}
		text="Some text"
		variant="text"
	/>
	<Button
		disabled={true}
		icon={{ path: mdiHome }}
		text="Some text"
		variant="text"
	/>
	<Button
		icon={{ path: mdiHome }}
		size="small"
		text="Some text"
		variant="text"
	/>
	<Button
		disabled={true}
		icon={{ path: mdiHome }}
		size="small"
		text="Some text"
		variant="text"
	/>
</section>
