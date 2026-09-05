/** Approved runtime identity assets. The complete brand kit stays outside git. */
export const brandAssetUrls = {
  favicon: new URL("./assets/favicon.ico", import.meta.url).href,
} as const;
