import { derived, writable } from "svelte/store";

const stores = new Map();

/**
 * @param {String} key
 * @param {Number} stepsCount
 */
function getOrCreateStore(key, stepsCount) {
    if (!stores.has(key)) {
        stores.set(key, createWizard(stepsCount));
    }
    return stores.get(key);
}


/** @param {Number} stepsCount */
function createWizard (stepsCount) {
	const currentStepIndex = writable(0);

	const isLastStep = derived(currentStepIndex, $currentStepIndex => $currentStepIndex === stepsCount - 1);
	const isFirstStep = derived(currentStepIndex, $currentStepIndex => $currentStepIndex === 0);

	function next () {
		currentStepIndex.update(n => (n < stepsCount - 1 ? n + 1 : n));
	}

	function back () {
		currentStepIndex.update(n => (n > 0 ? n - 1 : n));
	}

	return {
		currentStepIndex,
		next,
		back,
		isLastStep,
		isFirstStep
	};
}