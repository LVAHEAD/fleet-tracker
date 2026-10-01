# F.ETA.T — Fleet ETA Tracker

Веб-инструмент диспетчеров. Где машины (Mapon), сколько км и когда приедут (Google Routes API),
когда реально приедут с учётом тахографа (EU 561/2006), что мешает по пути (запреты, паромы).
Владелец — Владимир. Пользователи — он и диспетчеры. Интерфейс на русском.

Стек: Python 3 / Flask, gunicorn (`Procfile`: `gunicorn app:app`, 2 workers × 4 threads),
Cloud Run `fleet-eta-tracker`, europe-west1, проект `my-n8n-bot-496614`.
Вход — IAP по списку Google-аккаунтов. Общий Флот хранится в Firestore.
Фронтенд — ванильный JS без сборки (`static/`, `templates/index.html`).

## Правила работы (обязательно)

- **`git push` = деплой.** Cloud Build сразу выкатывает `main` на Cloud Run.
  Push только по явной команде **`//кодим`** или **`//деплой`** (одно и то же).
  До команды: готовим изменения локально, коммитим, докладываем и ждём.
- `//обс` — только обсуждение: без кода, коммитов и деплоя.
- Версии `vX.YY`: X — ключевое изменение, YY — обычные билды. Сейчас идёт ветка **3.x** (рефакторинг, см. `REFACTOR.md`).
- Каждый билд:
  - поднимает `APP_VERSION`;
  - добавляет запись в историю версий: сейчас это docstring `app.py`, после v3.00 — `CHANGELOG.md`;
  - коммитится как `vX.YY: кратко что сделано`.
- Мата и шуток в коде нет. Комментарии и тексты UI — на русском.
- Новые зависимости в `requirements.txt` — только по согласованию.

## Структура

Переезд из монолита идёт по `REFACTOR.md`. Пока шаг не сделан, код лежит в `app.py`.
Целевая раскладка (что где искать):

| Модуль | Что внутри |
|---|---|
| `app.py` | shim: `app = create_app()` |
| `fetat/config.py` | env-переменные, пороги, TTL |
| `fetat/utils/` | haversine, polyline, WKT, время, `TTLCache` |
| `fetat/clients/mapon.py` | unit/list, группы, тахограф, daily_activities, объекты, стоянки; семафор на 3 запроса |
| `fetat/clients/google_routes.py` | computeRoutes, кеш маршрутов, along-route, счётчик квоты |
| `fetat/clients/geocode.py` | Nominatim / Photon |
| `fetat/clients/sheets.py` | чтение листов «Fleet Tracker — данные» |
| `fetat/clients/firestore.py` | Firestore REST |
| `fetat/clients/nakordoni.py` | фид запретов движения |
| `fetat/domain/tacho.py` | тахо-ETA, недельный отдых, лимиты 56/90 ч |
| `fetat/domain/routing_rules.py` | паромы, Инсбрук, обход Швейцарии, waypoints |
| `fetat/domain/bans.py` | запреты по пути, ночь Австрии для MAN, бренд по VIN |
| `fetat/domain/regions.py` | коды регионов (ESxx, NO01…), ближайший код, страна |
| `fetat/domain/points.py` | разбор точки/таргета, ✓ пройдено, «на объекте» |
| `fetat/domain/trailers.py` | реф, сцепка тягач–прицеп |
| `fetat/domain/addresses.py` | адресная база, FIN/EE → База |
| `fetat/domain/freights.py` | база фрахтов, контрактники, похожие рейсы |
| `fetat/services/` | `fleet_calc.py` (/api/calc), `route_calc.py` (/api/route) |
| `fetat/store/fleet_store.py` | общий Флот: права, 🔒, корзина 24 ч |
| `fetat/api/` | Blueprints: fleet, calc, mapon, reference, meta |
| `data/` | `region_codes.json`, `region_codes_geonames.json` |
| `tests/` | pytest + фикстуры |

Зависимости идут только вниз: `api → services → domain + clients → utils/config`.
`domain` не ходит в сеть и не импортирует Flask.

## Предметные правила (не ломать)

- **Скорость для расчётов — 70 км/ч.** Время в From → To округляется вверх до 15 мин.
- **Тахограф:**
  - экипаж — до 18 ч вождения в сутки, отдых 9 ч;
  - одиночка — 9 ч вождения, отдых 9 или 11 ч (по оставшимся сокращениям), 10-й час не считаем;
  - к суточному отдыху +1 ч запаса, к недельному +30 мин, перерыв 45 мин без запаса;
  - недельные 24/45 в тахо-ETA не учитываем (их решают диспетчеры);
  - лимит 56/90 ч — только для одиночки.
- **Маршруты:**
  - Италия ↔ Германия — через Австрию (Инсбрук);
  - Италия ↔ Бенелюкс — никогда через Швейцарию;
  - Норвегия/Швеция: из Италии — Росток–Гедсер + Хельсингёр–Хельсингборг; из ES/PT/Бенелюкс/FR — Путтгарден–Рёдбю + Хельсингёр–Хельсингборг; из Германии — по близости к Ростоку или Путтгардену.
- **Австрия, 22:00–05:00:** у всех MAN нет L-наклейки, у DAF/Volvo она есть. Это только предупреждение 🚫, ETA не сдвигаем.
- **ADR не возим.** ADR-запреты скрыты.
- **FIN/EE как страна = База** (Baza Parking, Riga). Конкретная точка в Эстонии — напрямую.
- Прицепы в Mapon к тягачам не привязаны. Сцепку подтверждает человек.
- Фрахты: «2650+400» — берём только 2650; «6729/5500» — берём первую цену.
  Цены контрактников (SeaBorn, Kesko, GreenFood, Bama) в рыночную оценку не берём.

## Переменные окружения

`MAPON_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_MAPS_JS_KEY`, `HEAD_TRUCK_GROUP_ID` (62269),
`SHEET_ID`, `ADDRESS_SHEET`, `FREIGHT_SHEET`, `SETTINGS_SHEET`,
`FLEET_STORE` (`memory` — для локального запуска без Firestore), `FLEET_ADMINS`, `GOOGLE_CLOUD_PROJECT`.
Заданы в сервисе Cloud Run. Автодеплой их не трогает.

## Проверка перед `//кодим`

- `python -m py_compile` по всем `.py`;
- `pytest` (с v3.00);
- список маршрутов совпадает с эталоном;
- в отчёте Владимиру — что проверить руками после деплоя (чек-лист в `REFACTOR.md`).
