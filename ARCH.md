# F.ETA.T — устройство и предметные правила

Читать только перед работой с кодом (не для обсуждений, `//нб`, `//напомни`).

## Структура

Монолит разбит на модули (v3.00–v3.05, `REFACTOR.md`). Что где искать:

| Модуль | Что внутри |
|---|---|
| `app.py` | точка входа gunicorn: `app = create_app()` |
| `fetat/__init__.py` | `APP_VERSION`, `create_app()` — Flask с `root_path` = корень проекта, регистрация Blueprints |
| `fetat/config.py` | переменные окружения, папка `data/`, часовые пояса (Europe/Riga, Europe/Berlin; перевод часов — `utils/timefmt`) |
| `fetat/utils/` | `geo` (haversine, polyline, WKT, GPS), `timefmt`, `text` |
| `fetat/clients/mapon.py` | unit/list, группы, тахограф, daily_activities, объекты, стоянки; семафор на 4 запроса, повтор при «Request limit» |
| `fetat/clients/google_routes.py` | computeRoutes, кеш маршрутов, along-route, счётчик квоты |
| `fetat/clients/geocode.py` | Nominatim / Photon |
| `fetat/clients/sheets.py` | чтение листов «Fleet Tracker — данные» |
| `fetat/clients/firestore.py` | Firestore REST |
| `fetat/clients/nakordoni.py` | фид запретов движения: запросы, кеш, блокировки |
| `fetat/clients/monitoring.py` | счётчик запросов к Routes API (Cloud Monitoring), ряд по 5 мин для `/gusage` с разбивкой по ключу, методу и коду ответа |
| `fetat/domain/tacho.py` | простой ETA, движок `plan` (v3.39 — один на Флот, From → To и калькулятор), `tacho_eta`, `calc_plan`, окно смены / ночь (`shift_window_end`, `country_tz`), недельный отдых, лимиты 56/90 ч, `FRESH_SOLO_TACHO` |
| `fetat/domain/routing_rules.py` | паромы, Инсбрук, обход Швейцарии (кандидаты коридоров, «впритык»), waypoints |
| `fetat/domain/bans.py` | сборка фида запретов, запреты по пути, ночь Австрии для MAN, бренд по VIN, страны по маршруту |
| `fetat/domain/regions.py` | коды регионов (ESxx, NO01…), ближайший код, страна |
| `fetat/domain/points.py` | разбор точки/таргета, ✓ пройдено, «на объекте» |
| `fetat/domain/trailers.py` | реф (допуск по уставке), сцепка тягач–прицеп, вес с CAN тягача (`truck_weight`, v3.34) |
| `fetat/domain/addresses.py` | адресная база, FIN/EE → База |
| `fetat/domain/freights.py` | база фрахтов, контрактники, похожие рейсы |
| `fetat/domain/dispatchers.py` | лист «Диспетчеры»: инициалы, цвета, кто назначает; список по умолчанию; `can_assign` |
| `fetat/services/fleet_calc.py` | строка Флота: `calc_row(payload) -> (ответ, код)` и блоки `_unit_status`, `_add_trailer_info`, `_apply_points_done`, `_add_tacho`, `_add_route_context`, `_add_code_badges`; следующие точки `calc_extra_stops` |
| `fetat/services/gusage.py` | лог `/gusage`: наш счёт (`routes_stats`) и счёт Google по суткам Google и часам Риги (ключи, ошибки), текст для Claude; прогноз месяца `month_forecast` |
| `fetat/services/corridors.py` | точки маршрута по правилам + выбор коридора через Google, когда «впритык» (`resolve_waypoints`, `fleet_waypoints_resolved`); v3.32 — выбор диспетчера (`corridor` в трипе / From → To) и меню с км (`corridor_options`, `/api/corridors`) |
| `fetat/services/route_calc.py` | From → To: `route_calc(payload) -> (ответ, код)`, мультимаршрут с паромами |
| `fetat/store/fleet_store.py` | общий Флот: Firestore / память, права на удаление, 🔒, корзина 7 дней, проверка полей; архив завершённых трипов `fleet_done` (навсегда) |
| `fetat/api/meta.py` | `/`, `/api/me`, `/api/changelog`, `/api/google-usage`, `/gusage`, `/api/google-usage/log`; `current_user_email` (IAP) |
| `fetat/api/mapon.py` | `/api/units` (v3.38: у тягачей — координаты, едет / стоит, курс — слой `static/units-layer.js`), `/api/truck-info`, `/api/nearest-units`, `/api/mapon-units`, `/api/mapon-objects`, `/api/mapon-check` |
| `fetat/api/calc.py` | `/api/calc`, `/api/route` → services; `/api/eta-plan` — расклад калькулятора (v3.39) |
| `fetat/api/reference.py` | `/api/region-codes`, `/api/locate`, `/api/addresses`, `/api/freights`, `/api/bans` |
| `fetat/api/fleet.py` | `/api/fleet*`: чтение, sync (смена `disp` — только назначающий), 🔒, корзина, восстановление, импорт; завершить / вернуть / список завершённых (`complete`, `reopen`, `done` — хозяин или назначающий); `/api/dispatchers` |
| `static/eta-calc.js` | ⏱ ETA-калькулятор (v3.28): панель справа; v3.39 — расклад с сервера (`/api/eta-plan`, движок Флота), тянучка отдыха и «+1 ч» на дне — параметрами; v3.31 — `fromRow` (данные строки: `calc_seed` из `domain/tacho`), мини-карта по линии строки |
| `data/` | `region_codes.json`, `region_codes_geonames.json` |
| `tests/` | unittest + фикстуры; код через `A` из `tests/__init__.py` (ищет имя во всех модулях, подмена ставится везде) |

Новый эндпоинт — в подходящий Blueprint (`bp.route`), логика — в services/domain. Внутри обработчика `current_app`, не `app`.
Зависимости идут только вниз: `api → services → domain + clients → utils/config`.
`domain` не импортирует Flask и `requests`: в сеть — только через `fetat.clients`. Следит `tests/test_structure.py`.

## Предметные правила (не ломать)

- **Скорость для расчётов — 70 км/ч.** ETA / ETD и время в From → To — вверх до 15 мин (везде).
- **ETA — один движок** (v3.39, `domain/tacho.py`: `plan`): Флот (`tacho_eta`), From → To (ETD → ETA при выезде
  сейчас: From1 машина — по её тахографу, иначе соло со свежего дня) и ⏱ калькулятор (`calc_plan`, `/api/eta-plan`).
- **Тахограф:**
  - экипаж — до 18 ч вождения в сутки, отдых 9 ч, окно смены 21 ч;
  - одиночка — 9 ч вождения; 10-й час — только вручную (⋯ у строки Флота «+1 ч сегодня», в калькуляторе «д N +1 ч»);
    4:30 → перерыв 45 мин; отдых 9 ч (пока остались сокращения) или 11 ч, первый — по `daily_rest_min` из Mapon;
  - отдых — чистые 9 / 11 ч, без запаса (+1 ч / +30 мин убраны в v3.39);
  - окно смены соло — 15 ч; смена хоть частично в 00:00–04:00 (местное время страны, где машина) — 11 ч
    (9 вождения + 2 остальное): открыта 00:00–04:00 — 11 ч; после 04:00 — до 15 ч, но не дальше 00:00, а если ночь
    не обойти — 11 ч от начала (что больше). Первый день — от начала смены по Mapon;
  - недельные 24/45 сам расчёт не ставит (диспетчер; в калькуляторе — растянуть отдых);
  - лимит 56/90 ч — только одиночка и только отметка: ETA не сдвигаем (и на ②③);
  - погрузка / выгрузка во времени не учитывается — чистые км / время.
- **Маршруты:**
  - ИТ ↔ Бенелюкс: коридор может выбрать диспетчер (v3.32, поле `corridor` трипа) — выбор важнее правила; туннели Монблан ~261 € / Фрежюс 255 €;
  - Италия ↔ Германия — через Австрию (Инсбрук); из Тироля — только через Куфштайн (v3.29), не Фернпасс / Арльберг;
  - Италия ↔ Бенелюкс и восток Франции (Эльзас, Лотарингия, Франш-Конте) — никогда через Швейцарию: самый короткий из Инсбрук (→ Куфштайн) / Монблан / Фрежюс по прямой; если два лучших ближе 5 % — решает Google (v3.26);
  - Норвегия/Швеция: из Италии — Росток–Гедсер + Хельсингёр–Хельсингборг; из ES/PT/Бенелюкс/FR — Путтгарден–Рёдбю + Хельсингёр–Хельсингборг; из Германии — по близости к Ростоку или Путтгардену.
- **Австрия, 22:00–05:00:** у всех MAN нет L-наклейки, у DAF/Volvo она есть. Это только предупреждение 🚫, ETA не сдвигаем.
- **ADR не возим.** ADR-запреты скрыты.
- **FIN/EE как страна = База** (Baza Parking, Riga). Конкретная точка в Эстонии — напрямую.
- Прицепы в Mapon к тягачам не привязаны. Сцепку подтверждает человек.
- Фрахты: «2650+400» — берём только 2650; «6729/5500» — берём первую цену.
  Цены контрактников (SeaBorn, Kesko, GreenFood, Bama) в рыночную оценку не берём.

## Переменные окружения

`MAPON_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_MAPS_JS_KEY`, `HEAD_TRUCK_GROUP_ID` (62269),
`SHEET_ID`, `ADDRESS_SHEET`, `FREIGHT_SHEET`, `SETTINGS_SHEET`, `DISP_SHEET`,
`FLEET_STORE` (`memory` — для локального запуска без Firestore), `FLEET_ADMINS`, `GOOGLE_CLOUD_PROJECT`.
Заданы в сервисе Cloud Run. Автодеплой их не трогает.

## Проверка перед `//кодим`

- `python -m py_compile` по всем `.py`;
- `python -m unittest discover -s tests` — все зелёные;
- список маршрутов совпадает с эталоном;
- `tests/test_replay.py` совпадает с эталоном. Если поведение меняется намеренно (обычный билд с фичей) — пересобрать эталон: `python3 tests/replay_run.py "$PWD" "$PWD/tests/fixtures/replay_golden.json"` и проверить diff глазами;
- в отчёте Владимиру — что проверить руками после деплоя (чек-лист в `REFACTOR.md`).
