type ButtonIconProp = {
  path: string,
  position?: "after" | "before"
}

type GroupedSelectOptions = Record<string, SelectOption[] | string[]>;

type SelectOption = {
  disabled?: boolean,
  label?: string,
  value: string
}

type TextboxTypes = "email" | "hidden" | "multiline" | "number" | "password" | "search" | "tel" | "text" | "url";
