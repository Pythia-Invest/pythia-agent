/** The Design Lab is intentionally unavailable from every production route. */
export function shouldHideDesignLab(environment: string | undefined): boolean {
  return environment === "production";
}
