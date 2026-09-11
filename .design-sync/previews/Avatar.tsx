import { Avatar, Separator } from "@pythia/ui";

const crest =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" fill="#1f3a5f"/>' +
      '<path d="M32 12 L50 52 H14 Z" fill="#e8c07d"/>' +
      "</svg>",
  );

export function Sizes() {
  return (
    <div className="flex items-center gap-4">
      <Avatar fallback="NM" label="Northstar Materials" size="small" />
      <Avatar fallback="KL" label="Kestrel Logistics" size="medium" />
      <Avatar fallback="AU" label="Aldergrove Utilities" size="large" />
    </div>
  );
}

export function ImageAndFallback() {
  return (
    <div className="flex items-center gap-4">
      <Avatar
        fallback="NM"
        label="Northstar Materials issuer crest"
        size="large"
        src={crest}
      />
      <Avatar
        fallback="HL"
        label="Harbour Line Shipping, no crest on file"
        size="large"
      />
      <span className="text-foreground-secondary text-sm leading-relaxed">
        A supplied image on the left; the explicit fallback text on the right
        when no crest is archived.
      </span>
    </div>
  );
}

export function CoverageOwners() {
  const owners = [
    { fallback: "RM", initialsOf: "Rowan Maddox", role: "Industrials · 14 issuers" },
    { fallback: "IT", initialsOf: "Imre Tallis", role: "Utilities · 9 issuers" },
    { fallback: "SB", initialsOf: "Saskia Brandt", role: "Healthcare · 6 issuers" },
  ];
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-raised p-4 max-w-md">
      {owners.map((owner, index) => (
        <div className="flex flex-col gap-3" key={owner.fallback}>
          {index === 0 ? null : <Separator />}
          <div className="flex items-center gap-3">
            <Avatar fallback={owner.fallback} label={owner.initialsOf} size="medium" />
            <div className="flex flex-col min-w-0">
              <span className="font-medium text-sm truncate">
                {owner.initialsOf}
              </span>
              <span className="text-foreground-secondary text-xs truncate">
                {owner.role}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
