
type ButtonIconProp = {
  path: string,
  position?: "after" | "before"
  size?: IconSize,
}

type ButtonSize = "normal" | "small";

type ButtonVariant = "primary" | "secondary" | "tertiary" | "text";

type IconSize = "normal" | "large";

type GroupedSelectOptions = Record<string, SelectOption[] | string[]>;

type SelectOption = {
  disabled?: boolean,
  label?: string,
  value: string
}

type TabItem = {
	icon?: ButtonIconProp,
	id: string,
	label?: string
}

type TextboxTypes = "email" | "hidden" | "multiline" | "number" | "password" | "search" | "tel" | "text" | "url";

type TooltipType = "error" | "info" | "success" | "warning";

type MnemonicType = "authenticate" | "validate";
