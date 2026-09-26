"""Small hand-made source rows. Shapes follow the public formats: ISO 20022
auth.017 (FIRDS FULINS), auth.036 (DLTINS), auth.044 (FITRS), the GLEIF
`lei-records` JSON:API, SEC `company_tickers_exchange.json`, the ISO 10383 CSV
and OpenFIGI `/v3/mapping` answers. Values are illustrative, not provider copies.
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

ASML_ISIN, ASML_LEI = "NL0010273215", "724500Y6DUVHQD6OXN27"
SHELL_ISIN, SHELL_LEI = "GB00BP6MXD84", "21380068P1DRHMJ8KU70"
FUND_ISIN, FUND_LEI = "NL0000000001", "724500AAAAAAAAAAAA01"
NN_ISIN, NN_LEI = "NL0010773842", "724500BBBBBBBBBBBB02"

MIC_CSV = (
    "MIC,OPERATING MIC,OPRT/SGMT,MARKET NAME-INSTITUTION DESCRIPTION,LEGAL ENTITY NAME,LEI,MARKET CATEGORY CODE,"
    "ACRONYM,ISO COUNTRY CODE (ISO 3166),CITY,WEBSITE,STATUS\n"
    "XAMS,XAMS,OPRT,EURONEXT AMSTERDAM,,,RMKT,,NL,AMSTERDAM,,ACTIVE\n"
    "XAMC,XAMS,SGMT,EURONEXT AMSTERDAM MIDPOINT,,,RMKT,,NL,AMSTERDAM,,ACTIVE\n"
    "XETR,XETR,OPRT,XETRA,,,OTHR,,DE,FRANKFURT,,ACTIVE\n"
    "XETA,XETR,SGMT,XETRA REGULIERTER MARKT,,,RMKT,,DE,FRANKFURT,,ACTIVE\n"
    "XLON,XLON,OPRT,LONDON STOCK EXCHANGE,,,RMKT,,GB,LONDON,,ACTIVE\n"
    "XNAS,XNAS,OPRT,NASDAQ,,,RMKT,,US,NEW YORK,,ACTIVE\n"
    "XNYS,XNYS,OPRT,NEW YORK STOCK EXCHANGE,,,RMKT,,US,NEW YORK,,ACTIVE\n"
    "OTCM,OTCM,OPRT,OTC MARKETS,,,OTHR,,US,NEW YORK,,ACTIVE\n"
    "XCBO,XCBO,OPRT,CBOE GLOBAL MARKETS INC.,,,NSPD,,US,CHICAGO,,ACTIVE\n"
    "BATS,XCBO,SGMT,CBOE BZX U.S. EQUITIES EXCHANGE,,,NSPD,,US,CHICAGO,,ACTIVE\n"
)


def firds_record(isin, mic, lei, cfi="ESVUFR", name="SHARES", relevant="XAMS", first="2012-11-26", term=None, underlying=None):
    venue = f"<Id>{mic}</Id><IssrReq>true</IssrReq><FrstTradDt>{first}T08:00:00Z</FrstTradDt>"
    if term:
        venue += f"<TermntnDt>{term}T23:59:59Z</TermntnDt>"
    deriv = f"<DerivInstrmAttrbts><UndrlygInstrm><Sngl><ISIN>{underlying}</ISIN></Sngl></UndrlygInstrm></DerivInstrmAttrbts>" if underlying else ""
    return (
        f"<FinInstrmGnlAttrbts><Id>{isin}</Id><FullNm>{name}</FullNm><ShrtNm>{name[:10]}/SH</ShrtNm>"
        f"<ClssfctnTp>{cfi}</ClssfctnTp><NtnlCcy>EUR</NtnlCcy><CmmdtyDerivInd>false</CmmdtyDerivInd></FinInstrmGnlAttrbts>"
        f"<Issr>{lei}</Issr><TradgVnRltdAttrbts>{venue}</TradgVnRltdAttrbts>{deriv}"
        f"<TechAttrbts><RlvntCmptntAuthrty>NL</RlvntCmptntAuthrty><RlvntTradgVn>{relevant}</RlvntTradgVn></TechAttrbts>"
    )


def fulins(records: list[str]) -> bytes:
    body = "".join(f"<RefData>{r}</RefData>" for r in records)
    return (
        '<?xml version="1.0" encoding="UTF-8"?><BizData xmlns="urn:iso:std:iso:20022:tech:xsd:head.003.001.01"><Pyld>'
        '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:auth.017.001.02"><FinInstrmRptgRefDataRpt>'
        f"<RptHdr><RptgNtty><NtlCmptntAuthrty>EU</NtlCmptntAuthrty></RptgNtty></RptHdr>{body}"
        "</FinInstrmRptgRefDataRpt></Document></Pyld></BizData>"
    ).encode()


def dltins(records: list[tuple[str, str]]) -> bytes:
    body = "".join(f"<FinInstrm><{kind}>{r}</{kind}></FinInstrm>" for kind, r in records)
    return (
        '<?xml version="1.0" encoding="UTF-8"?><BizData><Pyld><Document xmlns="urn:iso:std:iso:20022:tech:xsd:auth.036.001.03">'
        f"<FinInstrmRptgRefDataDltaRpt>{body}</FinInstrmRptgRefDataDltaRpt></Document></Pyld></BizData>"
    ).encode()


def fitrs(rows: list[tuple[str, str, float]]) -> bytes:
    body = "".join(
        f"<EqtyTrnsprncyData><TechRcrdId>{i}</TechRcrdId><Id>{isin}</Id><FinInstrmClssfctn>SHRS</FinInstrmClssfctn>"
        f"<ApplPrd><FrDtToDt><FrDt>{start}</FrDt><ToDt>2027-03-31</ToDt></FrDtToDt></ApplPrd><Mthdlgy>YEAR</Mthdlgy>"
        f"<Sttstcs><AvrgDalyTrnvr Ccy=\"EUR\">{adt}</AvrgDalyTrnvr><AvrgDalyNbOfTxs>10.5</AvrgDalyNbOfTxs></Sttstcs>"
        "<RlvntMkt><Id>XAMS</Id></RlvntMkt></EqtyTrnsprncyData>"
        for i, (isin, start, adt) in enumerate(rows)
    )
    return f"<BizData><Pyld><Document><FinInstrmRptgEqtyTradgActvtyRslt>{body}</FinInstrmRptgEqtyTradgActvtyRslt></Document></Pyld></BizData>".encode()


def write_zip(directory: Path, name: str, xml: bytes) -> str:
    path = directory / name
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(name.replace(".zip", ".xml"), xml)
    return str(path)


def stream(xml: bytes) -> io.BytesIO:
    return io.BytesIO(xml)


def gleif_item(lei, name, language="en", other=(), status="ACTIVE", registration="ISSUED", ra="RA000463", ra_id="1"):
    return {
        "attributes": {
            "lei": lei,
            "entity": {
                "legalName": {"name": name, "language": language},
                "otherNames": [{"name": n, "type": t, "language": "en"} for n, t in other if not t.endswith("TRANSLITERATED_LEGAL_NAME")],
                "transliteratedOtherNames": [{"name": n, "type": t, "language": "en"} for n, t in other if t.endswith("TRANSLITERATED_LEGAL_NAME")],
                "legalAddress": {"country": lei[:2] if lei[:2].isalpha() else "NL"},
                "jurisdiction": "NL", "status": status, "registeredAt": {"id": ra}, "registeredAs": ra_id,
                "successorEntity": {"lei": None},
            },
            "registration": {"status": registration},
        }
    }


def sec_json(rows: list[tuple[int, str, str, str | None]]) -> bytes:
    return json.dumps({"fields": ["cik", "name", "ticker", "exchange"], "data": [list(r) for r in rows]}).encode()


def figi_row(ticker, exch, figi, scf, sec_type2="Common Stock", composite=None, name="ROW"):
    return {"figi": figi, "ticker": ticker, "exchCode": exch, "compositeFIGI": composite or figi, "shareClassFIGI": scf,
            "securityType": "Common Stock", "securityType2": sec_type2, "marketSector": "Equity", "name": name}


class FakeOpenFigi:
    """Answers from a dict keyed by (idType, idValue, micCode|exchCode); records every job."""

    def __init__(self, answers: dict[tuple, list[dict]]):
        self.answers = answers
        self.jobs: list[dict] = []

    def __call__(self, jobs: list[dict]) -> list[dict]:
        self.jobs.extend(jobs)
        out = []
        for job in jobs:
            key = (job["idType"], job["idValue"], job.get("micCode") or job.get("exchCode"))
            rows = self.answers.get(key)
            out.append({"data": rows} if rows else {"warning": "No identifier found."})
        return out
