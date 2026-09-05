# Synthetic provider fixtures

These fixtures are authored examples, not recorded provider responses.

- `eodhd-daily.json` models only `EodDataPoint` fields from the official EODHD
  SDK 1.1.0 type at
  <https://github.com/EodHistoricalData/EODHD-APIs-Node-Financial-Library/blob/9e3970daef47e95110e40a12ac30a31421fdd81c/src/types.ts>.
- The Python test objects model the `EntityFiling` and `FinancialFact` fields
  consumed from EdgarTools 5.56.0, documented in
  <https://github.com/dgunning/edgartools/blob/v5.56.0/edgar/entity/filings.py>
  and
  <https://github.com/dgunning/edgartools/blob/v5.56.0/edgar/entity/models.py>.

Names, dates, accession numbers, and values are deliberately fictional.
