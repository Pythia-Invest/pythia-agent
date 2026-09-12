import {
  Pagination,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationList,
  PaginationNext,
  PaginationPrevious,
} from "@pythia/ui";

export function FilingSearchResults() {
  return (
    <Pagination aria-label="Filing search results">
      <PaginationList>
        <PaginationItem>
          <PaginationPrevious href="#results-page-1" />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#results-page-1">1</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink current href="#results-page-2">
            2
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#results-page-3">3</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis>Pages 4 to 11</PaginationEllipsis>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#results-page-12">12</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#results-page-3" />
        </PaginationItem>
      </PaginationList>
    </Pagination>
  );
}

export function FirstPage() {
  return (
    <Pagination aria-label="Watchlist issuers">
      <PaginationList>
        <PaginationItem>
          <PaginationLink current href="#issuers-page-1">
            1
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#issuers-page-2">2</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#issuers-page-3">3</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#issuers-page-4">4</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#issuers-page-2" />
        </PaginationItem>
      </PaginationList>
    </Pagination>
  );
}

export function CompactRange() {
  return (
    <Pagination aria-label="Research notes">
      <PaginationList>
        <PaginationItem>
          <PaginationPrevious href="#notes-page-2">Older</PaginationPrevious>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#notes-page-4">Newer</PaginationNext>
        </PaginationItem>
      </PaginationList>
    </Pagination>
  );
}

export function InResultsFooter() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-border border-t bg-canvas px-4 py-3">
      <span className="text-foreground-secondary text-sm">
        Showing 21–40 of 238 archived filings
      </span>
      <Pagination aria-label="Archived filings">
        <PaginationList>
          <PaginationItem>
            <PaginationPrevious href="#filings-page-1" />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="#filings-page-1">1</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationLink current href="#filings-page-2">
              2
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="#filings-page-3">3</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationEllipsis>Pages 4 to 11</PaginationEllipsis>
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="#filings-page-12">12</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext href="#filings-page-3" />
          </PaginationItem>
        </PaginationList>
      </Pagination>
    </div>
  );
}
