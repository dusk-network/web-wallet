
type ButtonIconProp = {
  path: string,
  position?: "after" | "before"
  size?: IconSize,
}

type ButtonSize = "normal" | "small";

type BadgeVariant = "neutral" | "success" | "warning" | "error";

type ButtonVariant = "primary" | "secondary" | "tertiary" | "text";

type WizardButtonProps = {
	isAnchor?: boolean,
	href?: string,
	disabled?: boolean,
	icon?: ButtonIconProp,
	variant?: ButtonVariant,
	label?: string,
	action?: () => void,
}

type IconSize = "small" | "normal" | "large";

type GroupedSelectOptions = Record<string, SelectOption[] | string[]>;

type SelectOption = {
  disabled?: boolean,
  label?: string,
  value: string
}

type Status = {
	key: StatusMember,
	value: StatusValue
}

type StatusIconProp = {
	label?: string,
	path: string
  }

type StatusMember = {
	icon?: StatusIconProp,
	label: string
}

type StatusValue = {
	icon?: StatusIconProp,
	value: number
}

type TabItem = {
	icon?: ButtonIconProp,
	id: string,
	label?: string
}

type TextboxTypes = "email" | "hidden" | "multiline" | "number" | "password" | "search" | "tel" | "text" | "url";

type TooltipType = "error" | "info" | "success" | "warning";

type MnemonicType = "authenticate" | "validate";

type ToastItem = {
	icon?: string,
	id: string,
	message: string,
	type: TooltipType
}