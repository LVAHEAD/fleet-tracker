"""v3.301: Truck Info — часы недельного отдыха, недобор и «осталось» — в формате ЧЧ:ММ."""
import pathlib

S = (pathlib.Path(__file__).resolve().parents[1] / "fetat" / "api" / "mapon.py").read_text(encoding="utf-8")


def test_hm_format():
    assert '"hours": _hm(x["end"] - x["start"])' in S
    assert '"deficit": _hm(c["deficit"])' in S
    assert '"left": _hm(c["left"]) if c["left"] >= 60 else None' in S
    assert "ч\"," not in S.split('row["comp"]')[1][:700]   # целых «N ч» в компенсации больше нет
