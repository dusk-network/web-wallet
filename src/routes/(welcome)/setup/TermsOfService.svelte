<script>
	import {
		Anchor, AnchorButton, Button, Card
	} from "$lib/dusk/components";
</script>

<section class="terms-of-service flex flex-col flex-1">
	<Card heading="Terms &amp; Privacy Policy">
		<div class="flex flex-col gap-1">
			<p>Our <Anchor href="#">Terms &amp; Privacy Policy</Anchor> govern your use of our services,
			including data handling and user responsibilities.
			Your privacy and security are our top priorities.</p>
			<div class="flex gap-1 w-100">
				<AnchorButton
					className="tertiary flex-1"
					text="Cancel"
					href="/setup"
				/>
				<Button
					className="secondary flex-1"
					text="Accept"
				/>
			</div>
		</div>
	</Card>
</section>

<style>
	.terms-of-service {
		height: 100%;
		justify-content: center;
	}
</style>
