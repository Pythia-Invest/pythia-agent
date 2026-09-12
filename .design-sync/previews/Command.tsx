import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandSeparator,
} from "@pythia/ui";
import {
  BookmarkPlus,
  FileText,
  GitCompareArrows,
  Landmark,
  Table2,
} from "lucide-react";

/**
 * `Command` renders its surface in place — no portal — so the whole palette
 * fits inside a card. Cmdk highlights the first enabled item on mount.
 */
export function Default() {
  return (
    <div className="w-full max-w-sm">
      <Command label="Research actions">
        <CommandInput placeholder="Search actions…" />
        <CommandList label="Research actions">
          <CommandEmpty>No matching action.</CommandEmpty>
          <CommandGroup heading="Open">
            <CommandItem value="Open FY 2028 annual report">
              <FileText aria-hidden="true" size={16} />
              Open FY 2028 annual report
            </CommandItem>
            <CommandItem value="Open segment table">
              <Table2 aria-hidden="true" size={16} />
              Open segment table
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Research">
            <CommandItem value="Compare with peer set">
              <GitCompareArrows aria-hidden="true" size={16} />
              Compare with peer set
            </CommandItem>
            <CommandItem value="Add to watchlist">
              <BookmarkPlus aria-hidden="true" size={16} />
              Add to watchlist
            </CommandItem>
            <CommandItem disabled value="Import broker positions">
              <Landmark aria-hidden="true" size={16} />
              Import broker positions
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

/** A fixed search string keeps the filtered result set deterministic. */
export function Filtered() {
  return (
    <div className="w-full max-w-sm">
      <Command label="Research actions">
        <CommandInput placeholder="Search actions…" value="report" />
        <CommandList label="Research actions">
          <CommandEmpty>No matching action.</CommandEmpty>
          <CommandGroup heading="Open">
            <CommandItem value="Open FY 2028 annual report">
              <FileText aria-hidden="true" size={16} />
              Open FY 2028 annual report
            </CommandItem>
            <CommandItem value="Open Q3 2028 interim report">
              <FileText aria-hidden="true" size={16} />
              Open Q3 2028 interim report
            </CommandItem>
            <CommandItem value="Add to watchlist">
              <BookmarkPlus aria-hidden="true" size={16} />
              Add to watchlist
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

export function NoResults() {
  return (
    <div className="w-full max-w-sm">
      <Command label="Research actions">
        <CommandInput placeholder="Search actions…" value="restatement" />
        <CommandList label="Research actions">
          <CommandEmpty>
            No action matches “restatement”. Try “filing” or “peers”.
          </CommandEmpty>
          <CommandGroup heading="Open">
            <CommandItem value="Open FY 2028 annual report">
              Open FY 2028 annual report
            </CommandItem>
            <CommandItem value="Compare with peer set">
              Compare with peer set
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

export function Loading() {
  return (
    <div className="w-full max-w-sm">
      <Command label="Covered issuers">
        <CommandInput placeholder="Search covered issuers…" />
        <CommandList label="Covered issuers">
          <CommandLoading label="Reading the local filing archive">
            Reading the local filing archive…
          </CommandLoading>
        </CommandList>
      </Command>
    </div>
  );
}
