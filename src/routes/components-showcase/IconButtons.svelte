<script>
	import { mdiHome } from "@mdi/js";

	import { Button } from "$lib/dusk/components";
</script>

<section>
	<Button icon={{ path: mdiHome }}/>
	<Button
		disabled={true}
		icon={{ path: mdiHome }}
	/>
	<Button
		className="secondary"
		icon={{ path: mdiHome }}
	/>
	<Button
		className="secondary"
		disabled={true}
		icon={{ path: mdiHome }}
	/>
	<Button
		className="tertiary"
		icon={{ path: mdiHome }}
	/>
	<Button
		className="tertiary"
		disabled={true}
		icon={{ path: mdiHome }}
	/>
</section>
<section>
	<Button
		className="small"
		icon={{ path: mdiHome }}
	/>
	<Button
		className="small"
		disabled={true}
		icon={{ path: mdiHome }}
	/>
	<Button
		className="secondary small"
		icon={{ path: mdiHome }}
	/>
	<Button
		className="secondary small"
		disabled={true}
		icon={{ path: mdiHome }}
	/>
	<Button
		className="tertiary small"
		icon={{ path: mdiHome }}
	/>
	<Button
		className="tertiary small"
		disabled={true}
		icon={{ path: mdiHome }}
	/>
</section>
