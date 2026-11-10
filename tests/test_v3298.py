"""v3.298: при ошибке расчёта строка показывает последний удачный расчёт серым («⛴ нет данных»)."""
import pathlib

SRC = pathlib.Path(__file__).resolve().parents[1] / "static" / "app.js"
CSS = pathlib.Path(__file__).resolve().parents[1] / "static" / "style.css"


def test_stale_branch_and_reset():
    s = SRC.read_text(encoding="utf-8")
    assert "let lastGoodCalc = {}" in s
    assert "data.error && lastGoodCalc[id]" in s
    assert 'tr.classList.add("calc-stale")' in s
    assert "lastGoodCalc[id] = lastCalcText[id]" in s
    # правка строки / смена машины сбрасывает запас (не показать чужой расчёт)
    assert s.count("delete lastGoodCalc[") >= 4


def test_stale_css():
    assert "tr.calc-stale" in CSS.read_text(encoding="utf-8")
