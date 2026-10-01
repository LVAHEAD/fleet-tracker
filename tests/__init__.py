"""Тесты F.ETA.T (стандартный unittest, без внешних зависимостей).

Запуск из корня проекта:
    python -m unittest discover -s tests -v

Тесты обращаются к коду через объект A. Пока код лежит в app.py, A = модуль app.
Когда функции переедут в fetat/ (REFACTOR.md), меняется только этот файл.
"""
import os
import sys

os.environ.setdefault("FLEET_STORE", "memory")   # без Firestore и без ключей
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import app as A  # noqa: E402

FIXTURES = os.path.join(ROOT, "tests", "fixtures")
