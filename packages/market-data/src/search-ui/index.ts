/** Investment search frontend. Custom top bars import this entrypoint at build
 * time; the feature's own top bar is one composition of it. */
export {
  InvestmentSearch,
  type InvestmentSearchProps,
} from "./investment-search";
export {
  SearchPanel,
  type SearchPanelProps,
  type LookupState,
  type PanelStatus,
} from "./search-panel";
export {
  searchQueryKey,
  transportSearch,
  useDirectorySearch,
  type ListingsReader,
  type LookupRunner,
  type SearchBackend,
} from "./controller";
export {
  searchOptions,
  choiceOf,
  KIND_LABELS,
  TYPE_FILTERS,
  type RowSource,
  type ListingChoice,
  type SearchChoice,
  type SearchOption,
  type TypeFilter,
} from "./search-model";
export { ConnectorMark, connectorName } from "./search-row";
