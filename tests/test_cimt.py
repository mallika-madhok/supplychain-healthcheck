import io
import zipfile
from datetime import date

import httpx

from pipeline.sources import cimt


def _build_zip(csv_content: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("CIMT-CICM_Imp_2026/ODPFN015_202601N.csv", csv_content)
    return buffer.getvalue()


def test_fetch_cimt_hs4_imports_filters_and_aggregates_to_headings():
    csv_content = (
        "YearMonth/AnnéeMois,HS6,Country/Pays,Province,State/État,Value/Valeur,Quantity,Unit\n"
        '"202601","610910","BD","ON",,50000,1,"NMB"\n'
        '"202601","610990","BD","BC",,25000,1,"NMB"\n'
        '"202601","620342","VN","BC",,75000,1,"NMB"\n'
        '"202601","010121","AU","BC",,42472,1,"NMB"\n'
    )
    zip_bytes = _build_zip(csv_content)

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == cimt.CIMT_ZIP_URL_TEMPLATE.format(year=2026)
        return httpx.Response(200, content=zip_bytes)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    rows = cimt.fetch_cimt_hs4_imports(2026, client=client)

    assert len(rows) == 2
    tshirts = next(r for r in rows if r["hs4"] == "6109")
    assert tshirts["month"] == date(2026, 1, 1)
    assert tshirts["country"] == "BD"
    assert tshirts["import_value_cad"] == 75000.0  # two HS6 lines summed into one heading
    assert tshirts["hs2_chapter"] == "61"

    trousers = next(r for r in rows if r["hs4"] == "6203")
    assert trousers["country"] == "VN"
    assert trousers["import_value_cad"] == 75000.0
