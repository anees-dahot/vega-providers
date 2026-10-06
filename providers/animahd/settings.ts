import { ProviderContext, SettingsField } from "../types";
import { DEFAULT_BASE } from "./common";

export const getSettingsSchema = async function ({}: {
  providerContext: ProviderContext;
}): Promise<SettingsField[]> {
  return [
    {
      key: "baseUrlOverride",
      type: "text",
      label: "Custom Domain / Mirror URL",
      description: "Change this if the site moves to a new domain.",
      placeholder: DEFAULT_BASE,
      defaultValue: "",
    },
  ];
};
