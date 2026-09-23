/** Reusable feature frontend. Custom topbars import this entrypoint at build time. */
export {
  InvestmentSearch,
  type InvestmentSearchProps,
} from "./investment-search";
export {
  useInvestmentSearch,
  useSearchSources,
  useAdoptInvestment,
  investmentSearchKey,
  investmentSearchOptions,
  searchSourcesOptions,
  searchProviders,
  type AdoptedInvestment,
  type SearchTransport,
} from "./controller";
export { searchSettingsSchema } from "./settings";
