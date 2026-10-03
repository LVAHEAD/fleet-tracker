# REFACTOR — разбивка `app.py` на модули (ветка 3.x)

Решено 01.10.2026. Рефакторинг открывает ветку **3.x**: первый шаг выходит как v3.00.
Делаем строго по шагам. Пока рефакторинг идёт, косяки из v2.03 ждут.

## Зачем

На v2.03 `app.py` занимает 5341 строку и 307 КБ:

| Что | Строки | Объём |
|---|---|---|
| Changelog в docstring | 1–553 | 60 КБ |
| Словарь `REGION_CODES` | 587–1686 | 74 КБ |
| Код | остальное | ~173 КБ |

Почти половина файла — не код. Каждая правка тянет в контекст весь файл.
Цель — чтобы для правки, например, тахографа хватало прочитать `CLAUDE.md` и `fetat/domain/tacho.py`.

## Целевая структура

```
fleet-tracker/
├─ app.py                  # shim, ~10 строк: from fetat import create_app; app = create_app()
├─ CHANGELOG.md            # история версий; /api/changelog читает отсюда
├─ CLAUDE.md               # карта модулей и правила проекта
├─ REFACTOR.md             # этот план
├─ data/
│  ├─ region_codes.json
│  └─ region_codes_geonames.json
├─ fetat/
│  ├─ __init__.py          # create_app(), APP_VERSION, регистрация blueprints
│  ├─ config.py            # ключи из env, SHEET_ID, ID группы, пороги и TTL
│  ├─ utils/               # geo.py, timefmt.py, text.py
│  ├─ clients/             # только HTTP + кеш
│  │  ├─ mapon.py  google_routes.py  geocode.py  sheets.py  firestore.py  nakordoni.py  monitoring.py
│  ├─ domain/              # чистая логика, без Flask и без HTTP
│  │  ├─ tacho.py  routing_rules.py  bans.py  regions.py  points.py  trailers.py  addresses.py  freights.py
│  ├─ services/            # fleet_calc.py (тело api_calc), route_calc.py (тело api_route)
│  ├─ store/fleet_store.py # Firestore / Memory, права, 🔒, корзина
│  └─ api/                 # Blueprints: fleet.py calc.py mapon.py reference.py meta.py
└─ tests/                  # unittest + фикстуры
```

Зависимости идут только вниз: `api → services → domain + clients → utils/config`.
`domain` не импортирует `clients`: всё, что нужно извне, приходит аргументами.

## Шаги

Каждый шаг выходит отдельным билдом. Поведение после шага остаётся тем же, что и до него.

| Билд | Шаг | Что делаем | Риск |
|---|---|---|---|
| **v3.00** | 0 + 1 | `tests/` на unittest: тахо-ETA, паромы и Инсбрук, ночь Австрии для MAN, ✓ пройдено, разбор фрахта, справочники; эталон списка `/api/*` маршрутов. Changelog → `CHANGELOG.md` (`parse_changelog` читает файл), `REGION_CODES` → `data/region_codes.json`, geonames → `data/` | низкий |
| v3.01 | 2 | Каркас `fetat/`: `config.py` (переменные окружения, папка данных, сдвиг времени), `utils/` (geo, timefmt, text). Пороги и URL переезжают позже вместе со своей логикой. `app.py` импортирует из них | низкий |
| v3.02 | 3 | `clients/`: Mapon (с семафором), Google Routes (кеш, along-route, квота), геокодер, Sheets, Firestore, nakordoni, Monitoring — вместе со своими кешами и URL, кеши как есть | средний |
| v3.03 | 4 | `domain/`: tacho, routing_rules, bans (+ ночь Австрии для MAN), regions, points, trailers, addresses (+ FIN/EE → База), freights | средний |
| v3.04 | 5 | `store/fleet_store.py`; `services/`: `api_calc` (202 строки) и `api_route` (101 строка) разбираются на функции | выше среднего |
| v3.05 | 6 | Blueprints в `api/`, `app.py` → shim. Procfile (`gunicorn app:app`) не меняется | средний |
| позже | 7 | `static/app.js` (2200 строк) → ES-модули, отдельной темой | — |

## Правила переезда

1. **Переезд без ремонта.** В одном коммите код либо переносится, либо меняется, но не то и другое сразу. Багфиксы и улучшения — только отдельными билдами.
2. Имена функций и константы при переезде не переименовываем. Переименования — отдельным шагом, если понадобятся.
3. Кеши — изменяемые словари: модуль-владелец создаёт их один раз, остальные импортируют модуль, а не переменную. `global _cc_points` (сейчас `_country_at`) переделать на словарь-кеш.
4. Пути к данным — от `Path(__file__)`, не от текущей папки.
5. Новых зависимостей не добавляем. Тесты — на стандартном `unittest` (pytest их тоже запускает).
6. `FRESH_SOLO_TACHO` — не тестовая заготовка: им пользуется `/api/route` (тахо-ETA «свежего одиночки» в From → To). При переезде — в `domain/tacho.py`.
7. Тесты обращаются к коду через `tests/__init__.py` (`A`). Переносим функцию — дописываем её в `A`, сами тесты не трогаем.

## Проверка каждого шага

До push:
- `python -m py_compile` по всем файлам;
- `python -m unittest discover -s tests` зелёный;
- список маршрутов `app.url_map` совпадает с эталоном;
- `FLEET_STORE=memory` и локальный запуск: `/` и `/api/region-codes` отвечают 200.

После деплоя (проверяет Владимир):
- Флот → «Обновить всё»: км, ETA, тахо-ETA, 🚫, ✓, «📍 на объекте», прицепы с рефом;
- строка с паромом на Скандинавию и строка Италия → Германия (Инсбрук);
- From → To с несколькими точками и «Похожие рейсы»;
- Локатор, Карты стран, Запреты, Truck Info, блокнот [.] с историей версий;
- 🔒 блокировка, корзина и ↩.

Откат: Cloud Run → Revisions → трафик на прошлую ревизию.

## После рефакторинга (найдено по ходу, не чинить внутри 3.x-переезда)

- `RIGA_UTC_OFFSET = 3` задан жёстко. С 25.10.2026 Рига на UTC+2 — метки времени по Риге и «западной Европе» съедут на час. Перейти на `zoneinfo`.
- Тахо-ETA одиночки считает 10-й час, пока есть продления. Открытый вопрос «не считать 10-й час».
- Единый `TTLCache` вместо ~20 самописных кешей — по желанию, отдельным билдом.

## Статус

- [x] v3.00 — тесты + данные наружу (27 тестов; app.py 5341 → 3710 строк, 307 → 173 КБ)
- [x] v3.01 — каркас, config, utils (+ тесты utils)
- [ ] v3.02 — clients
- [ ] v3.03 — domain
- [ ] v3.04 — store + services
- [ ] v3.05 — blueprints, app.py → shim
- [ ] позже — фронтенд app.js
