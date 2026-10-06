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
      description: "AnimePahe changes domains often. Update it here if it breaks.",
      placeholder: DEFAULT_BASE,
      defaultValue: "",
    },
  ];
};
