"""v3.300: подсказки целей и машин — только по набранному тексту, пустое поле без списка."""
import pathlib

S = (pathlib.Path(__file__).resolve().parents[1] / "static" / "app.js").read_text(encoding="utf-8")


def test_points_empty_has_no_list():
    assert "if (!toks.length) { dl.replaceChildren(); return; }" in S


def test_units_lists_are_dynamic():
    assert "function fillUnitList(dlId, q)" in S
    assert 'UNIT_LIST_KIND = { "units-list": null, "trailers-list": "trailer", "trucks-list": "truck" }' in S
    # список машин больше не заливается целиком при загрузке
    assert 'datalist.innerHTML = "";' not in S
