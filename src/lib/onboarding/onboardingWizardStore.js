import { writable } from "svelte/store";

const { subscribe, set, update } = writable({ canGoNext: false, currentStep: 0, totalSteps: 0 });

/**
 * @param {Number} totalSteps
 */
function initializeStore (totalSteps) {
	set({ canGoNext: false, currentStep: 1, totalSteps });
}

/**
 * @param {String} field
 * @param {Number | Boolean} value
 */
function updateField (field, value) {
	update(values => ({ ...values, [field]: value }));
}

function reset () {
	set({ canGoNext: false, currentStep: 0, totalSteps: 0 });
}

const onboardingWizardStore = {
	initializeStore,
	reset,
	subscribe,
	updateCanGoNext: (/** @type {Boolean} */ newValue) => updateField("canGoNext", newValue),
	updateCurrentStep: (/** @type {Number} */ newValue) => updateField("currentStep", newValue)
};

export default onboardingWizardStore;
