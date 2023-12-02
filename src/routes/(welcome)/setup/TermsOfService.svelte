<script>
	import { page } from "$app/stores";
	import {
		Anchor, AnchorButton, Button, Card
	} from "$lib/dusk/components";
	import ONBOARDING_STEPS from "./onboardingSteps";
	import { onboardingWizardStore } from "$lib/stores";

	function beginOnboarding () {
		const totalSteps = $page.url.pathname.includes("create")
			? ONBOARDING_STEPS.CREATE : ONBOARDING_STEPS.RESTORE;

		onboardingWizardStore.initializeStore(totalSteps);
	}
</script>

<section class="flex flex-col flex-1">
	<Card heading="Terms &amp; Privacy Policy">
		<div class="flex flex-col gap-1">
			<p>Our <Anchor href="#">Terms &amp; Privacy Policy</Anchor> govern your use of our services,
			including data handling and user responsibilities.
			Your privacy and security are our top priorities.</p>
			<div class="flex gap-1 w-100">
				<AnchorButton
					className="flex-1"
					href="/setup"
					text="Cancel"
					variant="tertiary"
				/>
				<Button
					className="flex-1"
					text="Accept"
					on:click={beginOnboarding}
					variant="secondary"
				/>
			</div>
		</div>
	</Card>
</section>
