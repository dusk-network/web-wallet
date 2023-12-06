<script>
	import Button from '$lib/dusk/components/Button/Button.svelte';
    import Step from '$lib/dusk/components/Wizard/Step.svelte';
    import Wizard from '$lib/dusk/components/Wizard/Wizard.svelte';

    function customNextAction() {
        console.log('Custom next action');
    }

    function customBackAction() {
        console.log('Custom back action');
    }
</script>

<Wizard stepsCount={3}>
    <Step step={0}
        backButton={{variant: "tertiary",
        label: "Back",
        action: customBackAction }}

        nextButton={{variant: "tertiary",
        action: customNextAction,
        label: "Next" }}>
        <p>Norton</p>
    </Step>
    <Step step={1}>
        <p>Antonov</p>
    </Step>
    <Step step={2}>
        <p>Andreev</p>
    </Step>
</Wizard>