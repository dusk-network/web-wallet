<script>
	import { mdiCogOutline, mdiLinkCircle } from "@mdi/js";
	import { AnchorButton, Icon } from "$lib/dusk/components";
</script>

<section class="dashboard">
	<slot/>
	<footer class="footer">
		<nav class="footer__navigation">
			<div class="footer__network-status">
				<Icon className="footer__network-icon" path={mdiLinkCircle} size="large"/>
				<p>Dusk Testnet</p>
			</div>
			<AnchorButton
				variant="text"
				className="footer__anchor-button"
				icon={{ path: mdiCogOutline, size: "large" }}
				href="/settings"
				aria-label="Settings"
				data-tooltip-id="main-tooltip"
				data-tooltip-text="Settings"
				data-tooltip-place="left"
			/>
		</nav>
	</footer>
</section>

<style lang="postcss">
	.dashboard {
		display: flex;
		align-content: space-between;
		gap: 1.375rem;
		height: 100%;
		flex-wrap: wrap;
	}

	.footer {
		width: 100%;

		&__network-status {
			display: flex;
			align-items: center;
			gap: var(--small-gap);
			line-height: 0;
		}

		&__navigation {
			display: flex;
			justify-content: space-between;
			gap: 0.75rem;
			align-items: center;
			width: 100%;
		}

		:global(&__network-icon) {
			color: var(--success-color);
		}
	}
</style>
