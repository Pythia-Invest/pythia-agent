import type { ReactNode } from "react";

export function Specimen({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <section className="catalog-specimen">
      <h2>{label}</h2>
      <div className="catalog-specimen-stage">{children}</div>
    </section>
  );
}

export function SpecimenGrid({ children }: { children: ReactNode }) {
  return <div className="catalog-specimen-grid">{children}</div>;
}

export function DemoNote({ children }: { children: ReactNode }) {
  return <p className="catalog-demo-note">{children}</p>;
}

export function DemoIcon({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="catalog-demo-icon">
      {children}
    </span>
  );
}
