import io
import zipfile
from datetime import date

import httpx

from pipeline.sources import cimt


def _build_zip(csv_content: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("CIMT-CICM_Imp_2026/ODPFN022_202601N.csv", csv_content)
    return buffer.getvalue()


def test_fetch_cimt_hs2_imports_filters_to_apparel_chapters():
    csv_content = (
        "YearMonth/AnnéeMois,HS2,Country/Pays,Province,State/État,Value/Valeur\n"
        '"202601","61","BD","ON",,50000\n'
        '"202601","62","VN","BC",,75000\n'
        '"202601","01","AU","BC",,42472\n'
    )
    zip_bytes = _build_zip(csv_content)

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == cimt.CIMT_ZIP_URL_TEMPLATE.format(year=2026)
        return httpx.Response(200, content=zip_bytes)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    rows = cimt.fetch_cimt_hs2_imports(2026, client=client)

    assert len(rows) == 2
    knit = next(r for r in rows if r["hs2_chapter"] == "61")
    assert knit["month"] == date(2026, 1, 1)
    assert knit["country"] == "BD"
    assert knit["import_value_cad"] == 50000.0
    assert knit["hs2_label"] == "Apparel and clothing accessories, knitted or crocheted"

    woven = next(r for r in rows if r["hs2_chapter"] == "62")
    assert woven["country"] == "VN"
    assert woven["import_value_cad"] == 75000.0
