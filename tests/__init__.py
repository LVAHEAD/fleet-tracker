"""Тесты F.ETA.T (стандартный unittest, без внешних зависимостей).

Запуск из корня проекта:
    python -m unittest discover -s tests -v

Тесты обращаются к коду через объект A. A ищет имя в app.py и в модулях fetat/,
а подмена (A.x = ...) ставится во все модули, где это имя есть, — так подмена
работает и для функций, переехавших из app.py. При переезде тесты не меняются.
"""
import importlib
import os
import pkgutil
import sys

os.environ.setdefault("FLEET_STORE", "memory")   # без Firestore и без ключей
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import app  # noqa: E402
import fetat  # noqa: E402

FIXTURES = os.path.join(ROOT, "tests", "fixtures")


def _modules():
    mods = [app]
    for info in pkgutil.walk_packages(fetat.__path__, "fetat."):
        mods.append(importlib.import_module(info.name))
    return mods


class _All:
    def __init__(self):
        object.__setattr__(self, "_mods", _modules())

    def __getattr__(self, name):
        for m in self._mods:
            if hasattr(m, name):
                return getattr(m, name)
        raise AttributeError(name)

    def __setattr__(self, name, value):
        hit = [m for m in self._mods if hasattr(m, name)]
        if not hit:
            raise AttributeError(name)
        for m in hit:
            setattr(m, name, value)


A = _All()
