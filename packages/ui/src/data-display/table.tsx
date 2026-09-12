import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../class-name";

/** Native table props with a horizontally scrollable presentation wrapper. */
export interface TableProps extends ComponentPropsWithoutRef<"table"> {}

const cell = "px-3 py-2 text-start align-middle public:px-4 public:py-3";

/**
 * Presents basic row-and-column data in a responsive horizontal viewport.
 * Public/Product density and light/dark contrast come from semantic tokens;
 * native table semantics remain available to assistive technology with no
 * added keyboard grid model. Do compose it with caption, head, body, row,
 * header, and cell parts; don't use it as a DataGrid or spreadsheet.
 */
export function Table({ className, ...props }: TableProps) {
  return (
    <div
      className="w-full overflow-x-auto rounded-container border border-border"
      data-slot="table-viewport"
    >
      <table
        className={cn(
          "w-full border-collapse border-spacing-0 bg-raised text-start text-body text-foreground leading-ui",
          className,
        )}
        data-slot="table"
        {...props}
      />
    </div>
  );
}

/** Native caption props for the basic Table composition. */
export interface TableCaptionProps
  extends ComponentPropsWithoutRef<"caption"> {}

/**
 * Labels or summarizes a Table for sighted and screen-reader users. It follows
 * Public/Product typography and light/dark text tokens with no keyboard
 * interaction. Do provide a concise table identity when context does not
 * already label it; don't use it as detached explanatory prose.
 */
export function TableCaption({ className, ...props }: TableCaptionProps) {
  return (
    <caption
      className={cn(
        "caption-bottom px-4 py-3 text-start text-foreground-secondary",
        className,
      )}
      data-slot="table-caption"
      {...props}
    />
  );
}

/** Native table-head props for the basic Table composition. */
export interface TableHeaderProps extends ComponentPropsWithoutRef<"thead"> {}

/**
 * Groups Table column-header rows using native semantics. Public/Product and
 * light/dark presentation is inherited and there is no keyboard behavior. Do
 * place TableRow and TableHead children here; don't use it for ordinary data
 * rows.
 */
export function TableHeader({ className, ...props }: TableHeaderProps) {
  return (
    <thead
      className={cn("bg-subtle", className)}
      data-slot="table-header"
      {...props}
    />
  );
}

/** Native table-body props for the basic Table composition. */
export interface TableBodyProps extends ComponentPropsWithoutRef<"tbody"> {}

/**
 * Groups Table data rows using native semantics. Density follows Public/Product
 * and borders follow light/dark semantic tokens, with no added keyboard
 * model. Do place TableRow and TableCell children here; don't add virtualized or
 * selection behavior at this primitive layer.
 */
export function TableBody({ className, ...props }: TableBodyProps) {
  return (
    <tbody
      className={cn("[&>tr:hover]:bg-interaction-hover", className)}
      data-slot="table-body"
      {...props}
    />
  );
}

/** Native table-row props for the basic Table composition. */
export interface TableRowProps extends ComponentPropsWithoutRef<"tr"> {}

/**
 * Groups header or data cells as a native table row. Semantic borders and hover
 * treatment work in Public/Product and light/dark; the row is not keyboard
 * focusable or selectable by default. Do use native cells as children; don't
 * make the whole row an implicit action.
 */
export function TableRow({ className, ...props }: TableRowProps) {
  return (
    <tr
      className={cn("not-last:border-border not-last:border-b", className)}
      data-slot="table-row"
      {...props}
    />
  );
}

/** Native column- or row-header props for the basic Table composition. */
export interface TableHeadProps extends ComponentPropsWithoutRef<"th"> {}

/**
 * Identifies a native Table header cell. Typography and spacing adapt across
 * Public/Product and light/dark, while browser table semantics provide
 * accessibility without custom keyboard behavior. Do set `scope` where
 * association could be ambiguous; don't style a data cell as a header instead.
 */
export function TableHead({ className, ...props }: TableHeadProps) {
  return (
    <th
      className={cn(
        cell,
        "font-semibold text-foreground-secondary text-xs tracking-[0.02em]",
        className,
      )}
      data-slot="table-head"
      {...props}
    />
  );
}

/** Native data-cell props for the basic Table composition. */
export interface TableCellProps extends ComponentPropsWithoutRef<"td"> {}

/**
 * Presents one native Table data cell. Public/Product density and light/dark
 * text tokens are inherited; browser table semantics handle reading order with
 * no added keyboard behavior. Do keep supplied values truthful and formatted by
 * the owning app; don't calculate finance meaning inside this component.
 */
export function TableCell({ className, ...props }: TableCellProps) {
  return (
    <td className={cn(cell, className)} data-slot="table-cell" {...props} />
  );
}
