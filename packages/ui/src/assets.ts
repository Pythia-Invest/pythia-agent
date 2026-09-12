/** Approved runtime identity assets. The complete brand kit stays outside git. */
export const brandAssetUrls = {
  favicon: new URL("./assets/favicon.ico", import.meta.url).href,
  lockupFullLight: new URL(
    "./assets/lockup-full-light-640.png",
    import.meta.url,
  ).href,
  lockupFullDark: new URL("./assets/lockup-full-dark-640.png", import.meta.url)
    .href,
  lockupCompactLight: new URL(
    "./assets/lockup-compact-light-480.png",
    import.meta.url,
  ).href,
  lockupCompactDark: new URL(
    "./assets/lockup-compact-dark-480.png",
    import.meta.url,
  ).href,
  markLight: new URL("./assets/mark-light-256.png", import.meta.url).href,
  markDark: new URL("./assets/mark-dark-256.png", import.meta.url).href,
} as const;
