"""v3.396: приоритет прицепа при ✓ точек (OC-3156 / C-196U)."""
from fetat.domain.trailer_done import merge_trailer_done


def _p(done=False, auto=False, manual=None, **kw):
    return {"done": done, "auto": auto, "manual": manual, **kw}


def test_trailer_closes_point_truck_missed():
    dn = [_p(True, True), _p()]
    tdn = [_p(True, True), _p(True, True, zone="Bama Nyland")]
    out, merged = merge_trailer_done(dn, tdn, "C-196U")
    assert merged == [1] and out[1]["done"] and out[1]["by_trailer"] == "C-196U" and out[1]["zone"] == "Bama Nyland"


def test_manual_and_swap_not_overridden():
    dn = [_p(False, manual=False), _p(swap_done=True)]
    tdn = [_p(True, True), _p(True, True)]
    out, merged = merge_trailer_done(dn, tdn)
    assert merged == [] and not out[0]["done"]


def test_cascade_previous_points():
    dn = [_p(), _p(), _p()]
    tdn = [_p(), _p(), _p(True, True)]
    out, merged = merge_trailer_done(dn, tdn, "T")
    assert merged == [2] and out[0]["done"] and out[0]["by"] == 2 and out[1]["done"]


def test_trailer_not_done_changes_nothing():
    dn = [_p(True, True), _p()]
    out, merged = merge_trailer_done(dn, [_p(True, True), _p()], "T")
    assert merged == [] and out == dn
