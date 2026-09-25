"""
Fleet ETA Tracker — веб-версия Mapon + Google Routes ETA Calculator
Версия: 1.19

История изменений:
1.19 (2026-09-25) — Чехия на вкладке "Карты стран":
    - CZ добавлена, картинка захостена в проекте (static/postcode-maps/cz.png),
      файл прислан напрямую пользователем

1.18 (2026-09-25) — ещё три страны на вкладке "Карты стран":
    - Австрия (AT) — прямая ссылка на Wikimedia
    - Словакия (SK) — картинка не с внешней ссылки (та вела на страницу
      файла, не на саму картинку), а захостена в проекте
      (static/postcode-maps/sk.png), пользователь прислал файл напрямую
    - Венгрия (HU) — аналогично, захостена в проекте
      (static/postcode-maps/hu.webp) вместо внешней ссылки с ResearchGate
      (риск hotlink-блокировки)

1.17 (2026-09-25) — принудительные маршруты (Швейцария, паромы), пока
    только во вкладке From → To:
    - IT ↔ DE: всегда через Австрию (Инсбрук)
    - IT ↔ NO/SE: паромы Rostock–Gedser + Helsingør–Helsingborg
    - ES/PT/Benelux/FR ↔ NO/SE: паромы Puttgarden–Rødby + Helsingør–Helsingborg
    - DE ↔ NO/SE: тот же паром до Дании (Rostock или Puttgarden), выбирается
      по тому, какой порт ближе к точке в Германии, + Helsingør–Helsingborg
    - работает только когда оба поля From/To — коды регионов (страна
      определяется по первым двум буквам кода); для вкладки "Флот" (позиция
      машины из Mapon) правила пока не применяются — там страна отправления
      неизвестна без обратного геокодинга
    - road_distance_km_google получил параметр waypoints — промежуточные
      точки маршрута через Routes API "intermediates"
    - в интерфейсе появляется пометка, если правило применилось

1.16 (2026-09-25) — From → To: можно вводить только одно поле:
    - /api/route больше не требует оба поля; если задано только From или
      только To — возвращает координаты и лейбл этой точки без расстояния/
      маршрута (считать нечего)
    - фронтенд: если данных по обеим точкам нет, просто ставит маркер
      на карте и центрирует её, без попытки нарисовать маршрут

1.15 (2026-09-25) — откат avoidFerries:
    - v1.14 полностью запрещала паромы, но это была слишком грубая мера:
      выяснилось, что для маршрутов через Данию нужны именно два коротких
      парома (Puttgarden–Rødby, Helsingør–Helsingborg), а не длинный
      Kiel–Oslo, который выбрал Google. "Запретить все паромы" тут не
      решение — нужен принудительный маршрут через конкретные точки
      (waypoints), та же идея, что и обход Швейцарии (пока не реализовано,
      см. TODO в 1.13)

1.14 (2026-09-25) — без паромов:
    - в запрос к Routes API добавлен routeModifiers.avoidFerries: true —
      раньше Google иногда выбирал реальный грузовой паром (например
      Kiel–Oslo) вместо сухопутного пути через мосты Дании, что давало
      нереалистичный для вас маршрут/расстояние. Теперь маршрут всегда
      строится по земле. Затрагивает и вкладку "Флот", и "From → To" —
      обе используют одну и ту же функцию расчёта

1.13 (2026-09-25) — вкладки "Карты стран" и "From → To":
    - интерфейс разбит на три вкладки: Флот (прежняя таблица), Карты стран
      (почтовые зоны по странам, картинки с Wikimedia + таблица зон для
      Норвегии, где картинки в этой серии нет), From → To (расчёт)
    - /api/route (POST {"from": "ES30", "to": "SE25"}) — оба поля принимают
      GPS/город/код региона (переиспользует resolve_target); возвращает
      расстояние по дорогам, время в пути (70 км/ч) и полилинию маршрута
    - маршрут рисуется на отдельной карте той же логикой, что и во вкладке
      Флот (Routes API polyline, без легаси Directions)
    - TODO: обход Швейцарии для маршрутов Италия↔Бенелюкс — решили делать
      "всегда", но правило (когда именно подставлять waypoint) ещё не
      реализовано — сейчас маршрут строится как есть, без объезда

1.12 (2026-09-24) — визуальные правки статуса и ETA:
    - ETA в формате dd/mm HH:mm (без года) вместо dd.mm.yyyy HH:mm
    - ячейка "Статус" подсвечивается фоном: бледно-зелёный при "едет",
      бледно-красный при "стоит"
    - статус выводится в две строки: время в статусе сверху, скорость
      (если едет) отдельной строкой снизу

11 (2026-09-24) — фикс путаницы строк:
    - главная причина: счётчик id новых строк сбрасывался на 1 при каждой
      перезагрузке страницы, из-за чего у новой строки id мог совпасть с уже
      существующей (загруженной из localStorage) — из-за этого правки/удаление
      одной строки задевали другую. Теперь счётчик продолжается от максимального
      загруженного id
    - статус/км/ETA больше не стираются у соседних строк при добавлении или
      удалении строки — результат последнего расчёта кэшируется и
      восстанавливается при перерисовке таблицы, без лишнего запроса к серверу

10 (2026-09-24) — маршрут через Routes API вместо легаси Directions:
    - road_distance_km_google теперь возвращает ещё и encodedPolyline
      (route/polyline из Routes API) вместо использования устаревшего
      DirectionsService на фронтенде (требовал отдельно включённый
      Legacy Directions API — лишняя зависимость)
    - /api/calc отдаёт route_polyline, фронтенд сам декодирует и рисует линию
    - добавлен зелёный маркер-флажок для таргета на карте

9 (2026-09-24) — обновление построчно:
    - в каждой строке добавлена кнопка "↻ Обновить" — пересчитывает статус/км/
      ETA только этой строки, не трогая остальные (раньше было только
      "Обновить всё" сверху)

8 (2026-09-23) — коды регионов:
    - REGION_CODES заполнен реальными данными из GPS_Codes.xlsx (1096 кодов
      вида BE10, NO01, SE25 и т.п. → координаты); поле "Таргет" теперь
      принимает такие коды наравне с GPS и городами

7 (2026-09-23) — маршрут на карте по клику:
    - /api/calc теперь возвращает координаты таргета (target_lat, target_lng)
    - клик по строке рисует маршрут от машины до таргета (DirectionsService/
      DirectionsRenderer, тот же Google Maps ключ); если таргета нет — просто
      центрирует карту на машине, как раньше

6 (2026-09-23) — фикс автозаполнения браузера:
    - у всех input-полей в строках добавлены autocomplete="off" и уникальный
      name="...-{id}" — раньше Chrome иногда сам подставлял значение в поле
      "Машина" из своей истории автозаполнения, из-за отсутствия этих атрибутов

5 (2026-09-23) — номер версии виден на странице:
    - внизу страницы небольшая подпись "vN" — чтобы можно было свериться,
      какая версия реально задеплоена, не гадая по внешнему виду маркеров

4 (2026-09-23) — нумерация версий приведена в соответствие с версией файла
    (fleet-tracker v4.zip), дальше версии идут v5, v6 и т.д.
    Функционально совпадает с версией 1.2 (цветные маркеры по статусу).

--- версии до перехода на новую нумерацию ---
1.2 (2026-09-23) — цветные маркеры по статусу:
    - маркер на карте зелёный, когда машина едет, и красный, когда стоит
    - подпись номера крупнее и жирнее, цвет подписи совпадает со статусом

1.1 (2026-09-23) — карта:
    - /api/calc теперь возвращает текущие координаты машины (unit_lat, unit_lng)
    - index.html: добавлена карта (Google Maps JavaScript API) под таблицей
    - app.js: маркер на карте на каждую строку с известной позицией машины;
      клик по строке в таблице центрирует карту на этой машине
    - GOOGLE_MAPS_JS_KEY — ключ для клиентского Maps JavaScript API,
      передаётся в шаблон отдельно от серверного GOOGLE_API_KEY (Routes API)

1.0 (2026-09-23) — первая веб-версия:
    - Flask-бэкенд, оборачивающий логику из mapon_eta_calculator.py (Colab v1.4)
    - GET /api/units — список машин из группы Mapon "HEAD TRUCK" (для дропдауна)
    - POST /api/calc — статус машины + (если задан таргет) км/ETA по дорогам
    - Фронтенд (index.html + app.js) — таблица со строками, состояние в localStorage браузера
    - Карта пока НЕ реализована (отложено по решению пользователя)
    - Коды регионов (NO01, SE25 и т.п.) пока НЕ реализованы — ждём таблицу-справочник
      от пользователя; сейчас поддерживается только GPS и геокодинг города
"""

import math
import os
from datetime import datetime, timezone, timedelta

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

MAPON_API_KEY = os.environ.get("MAPON_API_KEY", "")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
# Ключ для клиентского Maps JavaScript API (виден в браузере — это нормально для
# этого типа ключа, если он ограничен по HTTP referrer в Google Cloud Console).
# Если не задан отдельно, используется тот же GOOGLE_API_KEY.
GOOGLE_MAPS_JS_KEY = os.environ.get("GOOGLE_MAPS_JS_KEY", GOOGLE_API_KEY)
HEAD_TRUCK_GROUP_ID = int(os.environ.get("HEAD_TRUCK_GROUP_ID", "62269"))
APP_VERSION = "1.19"

MAPON_API_URL = "https://mapon.com/api/v1/unit/list.json"
MAPON_GROUP_UNITS_URL = "https://mapon.com/api/v1/unit_groups/list_units.json"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"

RIGA_UTC_OFFSET = 3
WEST_EUROPE_OFFSET = RIGA_UTC_OFFSET - 1

STATUS_RU = {"standing": "стоит", "driving": "едет"}

# Справочник кодов регионов (NO01, SE25 и т.п.) → координаты.
# Сгенерирован из файла GPS_Codes.xlsx (1097 записей).
REGION_CODES = {
    "BE10": {"lat": 50.8504, "lng": 4.3488, "place": "Bruxelles"},
    "BE11": {"lat": 50.9057, "lng": 4.3922, "place": "Neder-Over-Heembeek"},
    "BE12": {"lat": 50.8439, "lng": 4.4291, "place": "Woluwe-Saint-Lambert"},
    "BE13": {"lat": 50.7309, "lng": 4.4858, "place": "La Hulpe"},
    "BE14": {"lat": 50.6404, "lng": 4.2058, "place": "Virginal-Samme"},
    "BE15": {"lat": 50.7338, "lng": 4.2345, "place": "Halle"},
    "BE16": {"lat": 50.7872, "lng": 4.2001, "place": "Sint-Laureins-Berchem"},
    "BE17": {"lat": 50.848, "lng": 4.2597, "place": "Dilbeek"},
    "BE18": {"lat": 50.93, "lng": 4.4519, "place": "Peutie"},
    "BE19": {"lat": 50.8684, "lng": 4.452, "place": "Sint-Stevens-Woluwe"},
    "BE21": {"lat": 51.2096, "lng": 4.4354, "place": "Borgerhout"},
    "BE22": {"lat": 51.1189, "lng": 4.8188, "place": "Morkhoven"},
    "BE23": {"lat": 51.3225, "lng": 4.9447, "place": "Turnhout"},
    "BE24": {"lat": 51.1919, "lng": 5.1166, "place": "Mol"},
    "BE25": {"lat": 51.1813, "lng": 4.6018, "place": "Broechem"},
    "BE26": {"lat": 51.1902, "lng": 4.4326, "place": "Berchem"},
    "BE28": {"lat": 51.0257, "lng": 4.4776, "place": "Mechelen"},
    "BE29": {"lat": 51.2411, "lng": 4.5834, "place": "Schilde"},
    "BE30": {"lat": 50.8796, "lng": 4.7009, "place": "Leuven"},
    "BE31": {"lat": 50.9868, "lng": 4.7819, "place": "Betekom"},
    "BE32": {"lat": 50.9663, "lng": 4.8041, "place": "Gelrode"},
    "BE33": {"lat": 50.8417, "lng": 4.9452, "place": "Bunsbeek"},
    "BE34": {"lat": 50.755, "lng": 5.048, "place": "Overwinden"},
    "BE35": {"lat": 50.8991, "lng": 5.3079, "place": "Sint-Lambrechts-Herk"},
    "BE36": {"lat": 50.965, "lng": 5.5008, "place": "Genk"},
    "BE37": {"lat": 50.8109, "lng": 5.4445, "place": "Neerrepen"},
    "BE38": {"lat": 50.7787, "lng": 5.131, "place": "Velm"},
    "BE39": {"lat": 51.2104, "lng": 5.4156, "place": "Pelt"},
    "BE40": {"lat": 50.6477, "lng": 5.5438, "place": "Glain"},
    "BE41": {"lat": 50.5376, "lng": 5.6256, "place": "Dolembreux"},
    "BE42": {"lat": 50.5844, "lng": 5.0928, "place": "Lamontzée"},
    "BE43": {"lat": 50.6976, "lng": 5.2552, "place": "Waremme"},
    "BE44": {"lat": 50.63684, "lng": 5.45017, "place": "TNT Hub"},
    "BE45": {"lat": 50.5041, "lng": 5.1868, "place": "Ben-Ahin"},
    "BE46": {"lat": 50.7544, "lng": 5.6803, "place": "Lixhe"},
    "BE47": {"lat": 50.6813, "lng": 6.0071, "place": "Lontzen"},
    "BE48": {"lat": 50.5904, "lng": 5.8325, "place": "Lambermont"},
    "BE49": {"lat": 50.3895, "lng": 6.0109, "place": "Bellevaux-Ligneuville"},
    "BE50": {"lat": 50.4686, "lng": 4.9117, "place": "Beez"},
    "BE51": {"lat": 50.5008, "lng": 4.609, "place": "Boignée"},
    "BE53": {"lat": 50.4021, "lng": 4.9593, "place": "Sart-Bernard"},
    "BE55": {"lat": 50.2242, "lng": 4.9593, "place": "Furfooz"},
    "BE56": {"lat": 50.0528, "lng": 4.495, "place": "Couvin"},
    "BE60": {"lat": 50.4114, "lng": 4.4445, "place": "Charleroi"},
    "BE61": {"lat": 50.4638, "lng": 4.3747, "place": "Courcelles"},
    "BE65": {"lat": 50.237, "lng": 4.2393, "place": "Beaumont"},
    "BE66": {"lat": 50.1324, "lng": 5.7896, "place": "Houffalize"},
    "BE67": {"lat": 49.7233, "lng": 5.62, "place": "Habay"},
    "BE68": {"lat": 49.7977, "lng": 5.0074, "place": "Corbion"},
    "BE69": {"lat": 50.0813, "lng": 5.1141, "place": "Wellin"},
    "BE70": {"lat": 50.4541, "lng": 3.9523, "place": "Mons"},
    "BE71": {"lat": 50.3887, "lng": 4.2054, "place": "Buvrinnes"},
    "BE73": {"lat": 50.4482, "lng": 3.8189, "place": "Saint-Ghislain"},
    "BE75": {"lat": 50.5692, "lng": 3.5047, "place": "Vezon"},
    "BE76": {"lat": 50.5528, "lng": 3.3422, "place": "Taintignies"},
    "BE77": {"lat": 50.7395, "lng": 3.236, "place": "Luingne"},
    "BE78": {"lat": 50.6317, "lng": 3.9962, "place": "Graty"},
    "BE79": {"lat": 50.5189, "lng": 3.6813, "place": "Quevaucamps"},
    "BE80": {"lat": 51.2393, "lng": 3.2475, "place": "Koolkerke"},
    "BE84": {"lat": 51.2422, "lng": 3.024, "place": "Klemskerke"},
    "BE85": {"lat": 50.828, "lng": 3.2649, "place": "Kortrijk"},
    "BE86": {"lat": 51.0354, "lng": 2.8387, "place": "Kaaskerke"},
    "BE87": {"lat": 50.8933, "lng": 3.3363, "place": "Ooigem"},
    "BE88": {"lat": 51.0333, "lng": 3.15, "place": "Lichtervelde"},
    "BE89": {"lat": 50.7837, "lng": 3.1635, "place": "Rekkem"},
    "BE90": {"lat": 51.05, "lng": 3.7167, "place": "Gent"},
    "BE91": {"lat": 51.1705, "lng": 4.3144, "place": "Kruibeke"},
    "BE92": {"lat": 51.0102, "lng": 4.0619, "place": "Oudegem"},
    "BE93": {"lat": 50.9239, "lng": 4.0043, "place": "Nieuwerkerken"},
    "BE94": {"lat": 50.8465, "lng": 3.975, "place": "Nederhasselt"},
    "BE95": {"lat": 50.7734, "lng": 3.8822, "place": "Geraardsbergen"},
    "BE96": {"lat": 50.906, "lng": 3.717, "place": "Beerlegem"},
    "BE98": {"lat": 51.0146, "lng": 3.6378, "place": "Sint-Martens-Latem"},
    "BE99": {"lat": 51.1017, "lng": 3.613, "place": "Lovendegem"},
    "CZ10": {"lat": 50.0774, "lng": 14.4658, "place": "Strašnice"},
    "CZ11": {"lat": 50.0877, "lng": 14.4045, "place": "Malá Strana"},
    "CZ13": {"lat": 50.0744, "lng": 14.4437, "place": "Vinohrady"},
    "CZ14": {"lat": 50.048, "lng": 14.4622, "place": "Praha 4-Michle"},
    "CZ15": {"lat": 50.072, "lng": 14.4041, "place": "Smíchov"},
    "CZ16": {"lat": 50.101, "lng": 14.3897, "place": "Praha 6-Hradčany"},
    "CZ18": {"lat": 50.1082, "lng": 14.4746, "place": "Praha 8-Libeň"},
    "CZ19": {"lat": 50.0949, "lng": 14.6689, "place": "Klánovice"},
    "CZ25": {"lat": 49.8965, "lng": 14.6824, "place": "Zaječice"},
    "CZ26": {"lat": 49.9769, "lng": 14.0901, "place": "Beroun-Zavadilka"},
    "CZ27": {"lat": 50.1473, "lng": 14.1029, "place": "Kladno"},
    "CZ28": {"lat": 49.8426, "lng": 14.8856, "place": "Xaverov"},
    "CZ29": {"lat": 50.8081, "lng": 15.0283, "place": "Chlístov"},
    "CZ30": {"lat": 49.7194, "lng": 13.3814, "place": "Doudlevce"},
    "CZ31": {"lat": 49.7451, "lng": 13.3339, "place": "Vinice-jih"},
    "CZ32": {"lat": 49.7281, "lng": 13.3702, "place": "Plzeň 3-Jižní Předměstí"},
    "CZ33": {"lat": 50.0097, "lng": 13.017, "place": "Nežichov"},
    "CZ34": {"lat": 49.373, "lng": 12.9547, "place": "Mlýneček"},
    "CZ35": {"lat": 50.1861, "lng": 12.4228, "place": "Chvoječná"},
    "CZ36": {"lat": 50.2147, "lng": 12.7715, "place": "Podhoří"},
    "CZ37": {"lat": 48.9369, "lng": 14.4144, "place": "České Budějovice 4"},
    "CZ38": {"lat": 48.8109, "lng": 14.3152, "place": "Český Krumlov"},
    "CZ39": {"lat": 49.2715, "lng": 14.4547, "place": "Nuzice"},
    "CZ40": {"lat": 50.7856, "lng": 14.0972, "place": "Sněžník"},
    "CZ41": {"lat": 50.5079, "lng": 14.0131, "place": "Radostice"},
    "CZ43": {"lat": 50.4764, "lng": 13.3114, "place": "Nebovazy"},
    "CZ44": {"lat": 50.317, "lng": 13.8946, "place": "Donín"},
    "CZ46": {"lat": 50.656, "lng": 14.6239, "place": "Janovice v Podještědí"},
    "CZ47": {"lat": 50.6549, "lng": 14.4867, "place": "Kvítkov"},
    "CZ50": {"lat": 50.2044, "lng": 15.8127, "place": "Pražské Předměstí"},
    "CZ51": {"lat": 50.1781, "lng": 16.2553, "place": "Lipovka"},
    "CZ53": {"lat": 49.9462, "lng": 15.7866, "place": "Vrcha"},
    "CZ54": {"lat": 50.3946, "lng": 15.8958, "place": "Slotov"},
    "CZ55": {"lat": 50.3391, "lng": 15.9302, "place": "Josefov"},
    "CZ56": {"lat": 49.4992, "lng": 16.0742, "place": "Mrhov"},
    "CZ57": {"lat": 49.8188, "lng": 16.7437, "place": "Petrušov"},
    "CZ58": {"lat": 49.5556, "lng": 15.5754, "place": "Suchá"},
    "CZ59": {"lat": 49.7275, "lng": 16.0031, "place": "Chlumětín"},
    "CZ61": {"lat": 49.2067, "lng": 16.5888, "place": "Sadová"},
    "CZ62": {"lat": 49.1526, "lng": 16.6556, "place": "Brno-Brněnské Ivanovice"},
    "CZ63": {"lat": 49.1832, "lng": 16.5612, "place": "Brno-Nový Lískovec"},
    "CZ64": {"lat": 49.2071, "lng": 16.4879, "place": "Žebětín"},
    "CZ66": {"lat": 49.2545, "lng": 16.7373, "place": "Ochoz u Brna"},
    "CZ67": {"lat": 49.3298, "lng": 16.6131, "place": "Svatá Kateřina"},
    "CZ68": {"lat": 49.4554, "lng": 16.7318, "place": "Ludíkov"},
    "CZ69": {"lat": 48.759, "lng": 16.882, "place": "Břeclav"},
    "CZ70": {"lat": 49.797, "lng": 18.2331, "place": "Ostrava-Zábřeh"},
    "CZ71": {"lat": 49.8369, "lng": 18.3112, "place": "Ostrava-Slezská Ostrava"},
    "CZ72": {"lat": 49.7706, "lng": 18.2843, "place": "Hrabová"},
    "CZ73": {"lat": 49.5961, "lng": 18.5247, "place": "Morávka"},
    "CZ74": {"lat": 49.6912, "lng": 18.0704, "place": "Nová Horka"},
    "CZ75": {"lat": 49.6797, "lng": 17.2831, "place": "Luboměř pod Strážnou"},
    "CZ76": {"lat": 49.2041, "lng": 17.6829, "place": "Kudlov"},
    "CZ77": {"lat": 49.5955, "lng": 17.2518, "place": "Olomouc"},
    "CZ78": {"lat": 49.5487, "lng": 17.094, "place": "Slatinky"},
    "CZ79": {"lat": 49.4719, "lng": 17.1118, "place": "Prostějov"},
    "DE01": {"lat": 51.4, "lng": 14.0, "place": "Grünewald"},
    "DE02": {"lat": 51.1825, "lng": 14.4292, "place": "Bautzen"},
    "DE03": {"lat": 51.7612, "lng": 14.3544, "place": "Cottbus"},
    "DE04": {"lat": 51.5875, "lng": 13.2364, "place": "Falkenberg/Elster"},
    "DE06": {"lat": 51.4753, "lng": 11.9973, "place": "Halle"},
    "DE07": {"lat": 50.5392, "lng": 11.9283, "place": "Mühltroff"},
    "DE08": {"lat": 50.7114, "lng": 12.4928, "place": "Zwickau"},
    "DE09": {"lat": 50.8333, "lng": 12.9167, "place": "Chemnitz, Sachsen"},
    "DE10": {"lat": 52.5323, "lng": 13.3846, "place": "Berlin"},
    "DE12": {"lat": 52.4799, "lng": 13.4371, "place": "Berlin"},
    "DE13": {"lat": 52.5667, "lng": 13.3333, "place": "Reinickendorf"},
    "DE14": {"lat": 52.4, "lng": 13.0667, "place": "Potsdam"},
    "DE15": {"lat": 52.3241, "lng": 14.5325, "place": "Frankfurt (Oder)"},
    "DE16": {"lat": 52.8342, "lng": 13.8218, "place": "Eberswalde"},
    "DE17": {"lat": 53.08, "lng": 13.7417, "place": "Temmen-Ringenwalde"},
    "DE18": {"lat": 54.0865, "lng": 12.1544, "place": "Rostock"},
    "DE19": {"lat": 53.0895, "lng": 11.2931, "place": "Besandten"},
    "DE20": {"lat": 53.5544, "lng": 9.9946, "place": "Hamburg"},
    "DE21": {"lat": 53.4858, "lng": 10.2267, "place": "Hamburg Bergedorf"},
    "DE22": {"lat": 53.5741, "lng": 10.076, "place": "Hamburg"},
    "DE23": {"lat": 53.8409, "lng": 10.8925, "place": "Selmsdorf"},
    "DE24": {"lat": 54.3205, "lng": 10.1327, "place": "Kiel"},
    "DE25": {"lat": 53.7833, "lng": 9.4833, "place": "Engelbrechtsche Wildnis"},
    "DE26": {"lat": 53.1547, "lng": 8.1706, "place": "Oldenburg"},
    "DE27": {"lat": 53.5002, "lng": 8.6047, "place": "Bremerhaven"},
    "DE28": {"lat": 53.0854, "lng": 8.7463, "place": "Bremen"},
    "DE29": {"lat": 52.6175, "lng": 10.085, "place": "Celle"},
    "DE30": {"lat": 52.3736, "lng": 9.7371, "place": "Hannover"},
    "DE31": {"lat": 52.0887, "lng": 9.6312, "place": "Salzhemmendorf"},
    "DE32": {"lat": 52.1337, "lng": 8.6963, "place": "Herford"},
    "DE33": {"lat": 51.733, "lng": 9.0197, "place": "Bad Driburg"},
    "DE34": {"lat": 51.3152, "lng": 9.4647, "place": "Kassel"},
    "DE35": {"lat": 50.4563, "lng": 8.7293, "place": "Münzenberg"},
    "DE36": {"lat": 50.3655, "lng": 9.5829, "place": "Schlüchtern"},
    "DE37": {"lat": 51.3334, "lng": 9.858, "place": "Witzenhausen"},
    "DE38": {"lat": 52.255, "lng": 10.541, "place": "Braunschweig"},
    "DE39": {"lat": 52.082, "lng": 11.586, "place": "Magdeburg"},
    "DE40": {"lat": 51.2002, "lng": 6.7564, "place": "Düsseldorf"},
    "DE41": {"lat": 51.1958, "lng": 6.4387, "place": "Mönchengladbach"},
    "DE42": {"lat": 51.2569, "lng": 7.1505, "place": "Wuppertal"},
    "DE44": {"lat": 51.55, "lng": 7.3167, "place": "Castrop-Rauxel"},
    "DE45": {"lat": 51.4273, "lng": 6.9967, "place": "Essen"},
    "DE46": {"lat": 51.4706, "lng": 6.8568, "place": "Oberhausen"},
    "DE47": {"lat": 51.4294, "lng": 6.7744, "place": "Duisburg"},
    "DE48": {"lat": 52.3007, "lng": 7.1576, "place": "Bad Bentheim"},
    "DE49": {"lat": 52.2738, "lng": 8.0521, "place": "Osnabrück"},
    "DE50": {"lat": 50.9562, "lng": 6.6349, "place": "Bergheim"},
    "DE51": {"lat": 50.994, "lng": 7.003, "place": "Köln"},
    "DE52": {"lat": 50.776, "lng": 6.0872, "place": "Aachen"},
    "DE53": {"lat": 50.7362, "lng": 7.1002, "place": "Bonn"},
    "DE54": {"lat": 49.7728, "lng": 6.6645, "place": "Trier"},
    "DE55": {"lat": 50.0051, "lng": 8.3134, "place": "Mainz-Kostheim"},
    "DE56": {"lat": 50.3567, "lng": 7.5932, "place": "Koblenz"},
    "DE57": {"lat": 50.8734, "lng": 8.0104, "place": "Siegen"},
    "DE58": {"lat": 51.3801, "lng": 7.4394, "place": "Hagen"},
    "DE59": {"lat": 51.0936, "lng": 8.6264, "place": "Bromskirchen"},
    "DE60": {"lat": 50.1159, "lng": 8.6702, "place": "Frankfurt am Main"},
    "DE61": {"lat": 50.1787, "lng": 8.7376, "place": "Bad Vilbel"},
    "DE63": {"lat": 49.9757, "lng": 9.1478, "place": "Aschaffenburg"},
    "DE64": {"lat": 49.8719, "lng": 8.6484, "place": "Darmstadt"},
    "DE65": {"lat": 50.0817, "lng": 8.2389, "place": "Wiesbaden"},
    "DE66": {"lat": 49.2469, "lng": 7.3698, "place": "Zweibrücken"},
    "DE67": {"lat": 49.4828, "lng": 8.4376, "place": "Ludwigshafen am Rhein"},
    "DE68": {"lat": 49.4934, "lng": 8.4653, "place": "Mannheim"},
    "DE69": {"lat": 49.4095, "lng": 8.6935, "place": "Heidelberg"},
    "DE70": {"lat": 48.7786, "lng": 9.1767, "place": "Stuttgart Stuttgart-Mitte"},
    "DE71": {"lat": 48.6821, "lng": 9.0117, "place": "Böblingen"},
    "DE72": {"lat": 48.6256, "lng": 9.342, "place": "Nürtingen"},
    "DE73": {"lat": 48.7075, "lng": 9.6514, "place": "Göppingen"},
    "DE74": {"lat": 49.1423, "lng": 9.2234, "place": "Heilbronn"},
    "DE75": {"lat": 49.1364, "lng": 8.9123, "place": "Eppingen"},
    "DE76": {"lat": 49.008, "lng": 8.42, "place": "Karlsruhe"},
    "DE77": {"lat": 48.4, "lng": 8.3333, "place": "Bad Rippoldsau-Schapbach"},
    "DE78": {"lat": 48.0667, "lng": 8.45, "place": "Villingen-Schwenningen"},
    "DE79": {"lat": 47.9942, "lng": 7.847, "place": "Freiburg im Breisgau"},
    "DE80": {"lat": 48.1345, "lng": 11.571, "place": "München"},
    "DE81": {"lat": 48.1475, "lng": 11.4635, "place": "München"},
    "DE82": {"lat": 48.066, "lng": 11.6156, "place": "Unterhaching"},
    "DE83": {"lat": 47.855, "lng": 12.1232, "place": "Rosenheim"},
    "DE84": {"lat": 48.5584, "lng": 11.7414, "place": "Au in der Hallertau"},
    "DE85": {"lat": 48.7667, "lng": 11.4147, "place": "Ingolstadt"},
    "DE86": {"lat": 48.1833, "lng": 10.9833, "place": "Egling an der Paar"},
    "DE87": {"lat": 47.7184, "lng": 10.3132, "place": "Kempten"},
    "DE88": {"lat": 48.0104, "lng": 8.986, "place": "Buchheim"},
    "DE89": {"lat": 48.5413, "lng": 10.2351, "place": "Niederstotzingen"},
    "DE90": {"lat": 49.2962, "lng": 11.2866, "place": "Pyrbaum"},
    "DE91": {"lat": 48.8683, "lng": 11.0734, "place": "Dollnstein"},
    "DE92": {"lat": 49.0341, "lng": 11.4739, "place": "Beilngries"},
    "DE93": {"lat": 48.8992, "lng": 11.652, "place": "Altmannstein"},
    "DE94": {"lat": 48.5732, "lng": 13.4506, "place": "Passau"},
    "DE95": {"lat": 49.8701, "lng": 11.8908, "place": "Kemnath"},
    "DE96": {"lat": 49.8934, "lng": 10.8911, "place": "Bamberg"},
    "DE97": {"lat": 49.759, "lng": 9.5085, "place": "Wertheim"},
    "DE98": {"lat": 50.608, "lng": 10.6957, "place": "Suhl"},
    "DE99": {"lat": 50.9746, "lng": 11.0297, "place": "Erfurt"},
    "DK08": {"lat": 55.6471, "lng": 12.2742, "place": "Høje Taastrup"},
    "DK09": {"lat": 57.048, "lng": 9.9187, "place": "København C"},
    "DK10": {"lat": 55.6759, "lng": 12.5655, "place": "København K"},
    "DK11": {"lat": 55.6798, "lng": 12.5827, "place": "København K"},
    "DK12": {"lat": 55.6777, "lng": 12.5784, "place": "København K"},
    "DK14": {"lat": 55.6865, "lng": 12.6085, "place": "København K"},
    "DK15": {"lat": 55.675, "lng": 12.5724, "place": "København V"},
    "DK16": {"lat": 55.6792, "lng": 12.5623, "place": "København V"},
    "DK17": {"lat": 55.6667, "lng": 12.5574, "place": "København V"},
    "DK18": {"lat": 55.6719, "lng": 12.5397, "place": "Frederiksberg C"},
    "DK19": {"lat": 55.6764, "lng": 12.5503, "place": "Frederiksberg C"},
    "DK27": {"lat": 55.7069, "lng": 12.4845, "place": "Brønshøj"},
    "DK29": {"lat": 55.8275, "lng": 12.5719, "place": "Skodsborg"},
    "DK31": {"lat": 56.084, "lng": 12.4523, "place": "Hornbæk"},
    "DK32": {"lat": 56.116, "lng": 12.2866, "place": "Gilleleje"},
    "DK33": {"lat": 55.9124, "lng": 12.0604, "place": "Ølsted"},
    "DK37": {"lat": 55.18, "lng": 14.8112, "place": "Klemensker"},
    "DK40": {"lat": 55.6459, "lng": 11.8572, "place": "Kirke Såby"},
    "DK42": {"lat": 55.3415, "lng": 11.1549, "place": "Korsør"},
    "DK45": {"lat": 55.8798, "lng": 11.6151, "place": "Nørre Asmindrup"},
    "DK46": {"lat": 55.3096, "lng": 12.3772, "place": "Store Heddinge"},
    "DK47": {"lat": 55.1778, "lng": 11.6523, "place": "Karrebæksminde"},
    "DK48": {"lat": 54.6636, "lng": 11.5015, "place": "Errindlev"},
    "DK49": {"lat": 54.9212, "lng": 11.2104, "place": "Horslunde"},
    "DK52": {"lat": 55.395, "lng": 10.5238, "place": "Marslev"},
    "DK53": {"lat": 55.5703, "lng": 10.6254, "place": "Martofte"},
    "DK54": {"lat": 55.5548, "lng": 10.0939, "place": "Bogense"},
    "DK55": {"lat": 55.4228, "lng": 9.9224, "place": "Ejby"},
    "DK56": {"lat": 55.0639, "lng": 10.2517, "place": "Bjørnø"},
    "DK57": {"lat": 55.179, "lng": 10.5316, "place": "Kværndrup"},
    "DK58": {"lat": 55.322, "lng": 10.7801, "place": "Nyborg"},
    "DK59": {"lat": 54.923, "lng": 10.7403, "place": "Rudkøbing"},
    "DK63": {"lat": 54.858, "lng": 9.4359, "place": "Kruså"},
    "DK64": {"lat": 54.9213, "lng": 9.7764, "place": "Sønderborg"},
    "DK65": {"lat": 55.4235, "lng": 9.3053, "place": "Vamdrup"},
    "DK66": {"lat": 55.6063, "lng": 8.9381, "place": "Hovborg"},
    "DK67": {"lat": 55.6024, "lng": 8.8009, "place": "Agerbæk"},
    "DK69": {"lat": 56.0102, "lng": 8.8682, "place": "Kibæk"},
    "DK71": {"lat": 55.8443, "lng": 9.591, "place": "Uldum"},
    "DK73": {"lat": 56.0173, "lng": 9.3582, "place": "Hampen"},
    "DK76": {"lat": 56.6012, "lng": 8.1592, "place": "Harboøre"},
    "DK77": {"lat": 56.8782, "lng": 8.5045, "place": "Snedsted"},
    "DK78": {"lat": 56.5815, "lng": 9.1723, "place": "Højslev"},
    "DK82": {"lat": 56.1976, "lng": 10.2292, "place": "Risskov"},
    "DK83": {"lat": 55.913, "lng": 10.0565, "place": "Hundslund"},
    "DK85": {"lat": 56.3521, "lng": 10.3423, "place": "Mørke"},
    "DK86": {"lat": 56.0898, "lng": 9.5503, "place": "Them"},
    "DK87": {"lat": 55.755, "lng": 10.284, "place": "Endelave"},
    "DK89": {"lat": 56.4306, "lng": 10.3752, "place": "Auning"},
    "DK92": {"lat": 57.0108, "lng": 9.9382, "place": "Aalborg SØ"},
    "DK93": {"lat": 57.1791, "lng": 10.2976, "place": "Dronninglund"},
    "DK94": {"lat": 57.1072, "lng": 9.5186, "place": "Brovst"},
    "DK95": {"lat": 56.8945, "lng": 9.8197, "place": "Støvring"},
    "DK96": {"lat": 56.7691, "lng": 9.2872, "place": "Farsø"},
    "ES01": {"lat": 42.90743, "lng": -2.69727, "place": "Álava"},
    "ES02": {"lat": 38.99336, "lng": -1.85846, "place": "Albacete"},
    "ES03": {"lat": 38.34513, "lng": -0.49112, "place": "Alicante"},
    "ES04": {"lat": 36.85104, "lng": -2.45362, "place": "Almería"},
    "ES05": {"lat": 40.69316, "lng": -4.89193, "place": "Ávila"},
    "ES06": {"lat": 38.87797, "lng": -6.97306, "place": "Badajoz"},
    "ES08": {"lat": 41.38693, "lng": 2.16775, "place": "Barcelona"},
    "ES09": {"lat": 42.34999, "lng": -3.68832, "place": "Burgos"},
    "ES10": {"lat": 39.64902, "lng": -6.23691, "place": "Cáceres"},
    "ES11": {"lat": 36.52009, "lng": -6.28146, "place": "Cádiz"},
    "ES12": {"lat": 40.14731, "lng": -0.14679, "place": "Castellón"},
    "ES13": {"lat": 38.98526, "lng": -3.92961, "place": "Ciudad Real"},
    "ES14": {"lat": 37.88879, "lng": -4.78262, "place": "Córdoba"},
    "ES15": {"lat": 43.36507, "lng": -8.40906, "place": "A Coruña (Coruña, La)"},
    "ES16": {"lat": 40.07102, "lng": -2.1351, "place": "Cuenca"},
    "ES17": {"lat": 41.97879, "lng": 2.8198, "place": "Girona (Gerona)"},
    "ES18": {"lat": 37.18249, "lng": -3.59971, "place": "Granada"},
    "ES19": {"lat": 40.63246, "lng": -3.15837, "place": "Guadalajara"},
    "ES20": {"lat": 43.07641, "lng": -2.22581, "place": "Gipuzkoa (Guipúzcoa)"},
    "ES21": {"lat": 37.26213, "lng": -6.94076, "place": "Huelva"},
    "ES22": {"lat": 42.13239, "lng": -0.40575, "place": "Huesca"},
    "ES23": {"lat": 37.7804, "lng": -3.78763, "place": "Jaén"},
    "ES24": {"lat": 42.59833, "lng": -5.56956, "place": "León"},
    "ES25": {"lat": 42.07309, "lng": 1.06059, "place": "Lleida (Lérida)"},
    "ES26": {"lat": 42.46294, "lng": -2.44275, "place": "La Rioja (Logroño)"},
    "ES27": {"lat": 43.00773, "lng": -7.55425, "place": "Lugo"},
    "ES28": {"lat": 40.41864, "lng": -3.68293, "place": "Madrid"},
    "ES29": {"lat": 36.71894, "lng": -4.42243, "place": "Málaga"},
    "ES30": {"lat": 37.99099, "lng": -1.12619, "place": "Murcia"},
    "ES31": {"lat": 42.06483, "lng": -1.63473, "place": "Tudella"},
    "ES32": {"lat": 42.33633, "lng": -7.86731, "place": "Ourense (Orense)"},
    "ES33": {"lat": 43.36297, "lng": -5.84614, "place": "Asturias (Oviedo)"},
    "ES34": {"lat": 42.0094, "lng": -4.53129, "place": "Palencia"},
    "ES35": {"lat": 27.98406, "lng": -15.63246, "place": "Las Palmas (Palmas, Las)"},
    "ES36": {"lat": 42.43068, "lng": -8.64144, "place": "Pontevedra"},
    "ES37": {"lat": 40.97111, "lng": -5.66629, "place": "Salamanca"},
    "ES38": {"lat": 28.46397, "lng": -16.24987, "place": "Santa Cruz de Tenerife"},
    "ES39": {"lat": 43.46379, "lng": -3.82041, "place": "Cantabria (Santander)"},
    "ES40": {"lat": 40.94255, "lng": -4.11078, "place": "Segovia"},
    "ES41": {"lat": 37.39018, "lng": -5.97937, "place": "Seville (Sevilla)"},
    "ES42": {"lat": 41.76628, "lng": -2.48098, "place": "Soria"},
    "ES43": {"lat": 41.11995, "lng": 1.24591, "place": "Tarragona"},
    "ES44": {"lat": 40.34637, "lng": -1.10429, "place": "Teruel"},
    "ES45": {"lat": 39.86293, "lng": -4.02533, "place": "Toledo"},
    "ES46": {"lat": 39.47221, "lng": -0.37769, "place": "Valencia"},
    "ES47": {"lat": 41.65529, "lng": -4.7197, "place": "Valladolid"},
    "ES48": {"lat": 43.22021, "lng": -2.7001, "place": "Biscay (Vizcaya)"},
    "ES49": {"lat": 41.50312, "lng": -5.74499, "place": "Zamora"},
    "ES50": {"lat": 41.65003, "lng": -0.88323, "place": "Zaragoza"},
    "ES51": {"lat": 35.88953, "lng": -5.32285, "place": "Ceuta"},
    "ES52": {"lat": 35.29367, "lng": -2.9511, "place": "Melilla"},
    "FI00": {"lat": 60.1714, "lng": 24.9316, "place": "Helsinki"},
    "FI01": {"lat": 60.3005, "lng": 25.3271, "place": "Söderkulla"},
    "FI02": {"lat": 60.2052, "lng": 24.6522, "place": "Espoo"},
    "FI03": {"lat": 60.3334, "lng": 24.3216, "place": "Nummela"},
    "FI04": {"lat": 60.4034, "lng": 25.105, "place": "Kerava"},
    "FI05": {"lat": 60.5188, "lng": 24.7316, "place": "Rajamäki"},
    "FI06": {"lat": 60.3079, "lng": 25.5441, "place": "Porvoo"},
    "FI07": {"lat": 60.4665, "lng": 25.3891, "place": "Pornainen"},
    "FI08": {"lat": 60.2486, "lng": 24.0653, "place": "Lohja"},
    "FI09": {"lat": 60.3409, "lng": 24.0258, "place": "Millola"},
    "FI10": {"lat": 60.0459, "lng": 24.0046, "place": "Inkoo"},
    "FI11": {"lat": 60.7505, "lng": 24.7857, "place": "Riihimäki"},
    "FI12": {"lat": 60.8141, "lng": 24.6259, "place": "Tervakoski"},
    "FI13": {"lat": 60.984, "lng": 24.4921, "place": "Hämeenlinna"},
    "FI14": {"lat": 60.9167, "lng": 24.6333, "place": "Turenki"},
    "FI15": {"lat": 60.9694, "lng": 25.6321, "place": "Lahti"},
    "FI16": {"lat": 61.1172, "lng": 24.9798, "place": "Lammi"},
    "FI17": {"lat": 61.1785, "lng": 25.5363, "place": "Vääksy"},
    "FI19": {"lat": 61.5196, "lng": 26.2031, "place": "Koitti"},
    "FI20": {"lat": 60.4515, "lng": 22.2687, "place": "Turku"},
    "FI21": {"lat": 60.2867, "lng": 22.1633, "place": "Parainen"},
    "FI23": {"lat": 60.6791, "lng": 21.9927, "place": "Mynämäki"},
    "FI24": {"lat": 60.3833, "lng": 23.1333, "place": "Salo"},
    "FI25": {"lat": 60.2137, "lng": 22.7954, "place": "Kemiö"},
    "FI26": {"lat": 61.1272, "lng": 21.5113, "place": "Rauma"},
    "FI27": {"lat": 61.2, "lng": 21.7333, "place": "Eurajoki"},
    "FI28": {"lat": 61.4811, "lng": 21.8129, "place": "Pori"},
    "FI29": {"lat": 61.3637, "lng": 21.6256, "place": "Luvia"},
    "FI30": {"lat": 60.8146, "lng": 23.6215, "place": "Forssa"},
    "FI31": {"lat": 60.6167, "lng": 23.5333, "place": "Somero"},
    "FI32": {"lat": 60.8497, "lng": 23.0561, "place": "Loimaa"},
    "FI33": {"lat": 61.4795, "lng": 23.9886, "place": "Tampere"},
    "FI34": {"lat": 61.7372, "lng": 23.7105, "place": "Länsi-Teisko"},
    "FI35": {"lat": 61.6664, "lng": 24.2872, "place": "Orivesi"},
    "FI36": {"lat": 61.3342, "lng": 24.272, "place": "Pälkäne"},
    "FI37": {"lat": 61.2642, "lng": 24.0312, "place": "Valkeakoski"},
    "FI38": {"lat": 61.6, "lng": 22.6, "place": "Lavia"},
    "FI39": {"lat": 62.0952, "lng": 22.6744, "place": "Suomijärvi"},
    "FI40": {"lat": 62.2874, "lng": 25.7406, "place": "Jyväskylä"},
    "FI41": {"lat": 62.4047, "lng": 25.6753, "place": "Tikkakoski"},
    "FI42": {"lat": 62.1514, "lng": 24.1197, "place": "Pohjaslahti"},
    "FI43": {"lat": 62.7049, "lng": 25.254, "place": "Saarijärvi"},
    "FI44": {"lat": 62.6001, "lng": 25.7373, "place": "Äänekoski"},
    "FI45": {"lat": 60.8667, "lng": 26.7, "place": "Kouvola"},
    "FI46": {"lat": 60.8526, "lng": 27.3353, "place": "Saaramaa"},
    "FI47": {"lat": 60.7161, "lng": 26.4352, "place": "Elimäki"},
    "FI48": {"lat": 60.4664, "lng": 26.9458, "place": "Kotka"},
    "FI49": {"lat": 60.5573, "lng": 27.15, "place": "Poitsila"},
    "FI50": {"lat": 61.6886, "lng": 27.2723, "place": "Mikkeli"},
    "FI51": {"lat": 61.8777, "lng": 26.5906, "place": "Kangasniemi"},
    "FI52": {"lat": 61.5273, "lng": 28.175, "place": "Puumala"},
    "FI53": {"lat": 61.0587, "lng": 28.1887, "place": "Lappeenranta"},
    "FI54": {"lat": 61.1401, "lng": 28.5537, "place": "Joutseno"},
    "FI55": {"lat": 61.1947, "lng": 28.6701, "place": "Tiuruniemi"},
    "FI56": {"lat": 61.2833, "lng": 28.8333, "place": "Ruokolahti"},
    "FI57": {"lat": 61.8699, "lng": 28.88, "place": "Savonlinna"},
    "FI58": {"lat": 62.0952, "lng": 28.928, "place": "Enonkoski"},
    "FI59": {"lat": 61.55, "lng": 29.5, "place": "Parikkala"},
    "FI60": {"lat": 62.8429, "lng": 22.954, "place": "Atria"},
    "FI61": {"lat": 62.4333, "lng": 22.1833, "place": "Kauhajoki"},
    "FI62": {"lat": 62.9693, "lng": 23.0088, "place": "Lapua"},
    "FI63": {"lat": 62.7886, "lng": 23.6064, "place": "Kuortane"},
    "FI64": {"lat": 62.4819, "lng": 21.7416, "place": "Teuva"},
    "FI65": {"lat": 63.1216, "lng": 21.5166, "place": "Vaasa"},
    "FI66": {"lat": 62.6936, "lng": 21.9793, "place": "Jurva"},
    "FI67": {"lat": 63.8484, "lng": 23.081, "place": "Kokkola"},
    "FI68": {"lat": 63.7286, "lng": 23.0339, "place": "Kruunupyy"},
    "FI69": {"lat": 63.7667, "lng": 24.25, "place": "Toholampi"},
    "FI70": {"lat": 62.889, "lng": 27.628, "place": "Vastauslähetys"},
    "FI71": {"lat": 63.204, "lng": 27.5003, "place": "Alapitkä"},
    "FI72": {"lat": 63.1979, "lng": 26.5015, "place": "Mäntylä"},
    "FI73": {"lat": 63.3593, "lng": 27.7551, "place": "Varpaisjärvi"},
    "FI74": {"lat": 63.5592, "lng": 27.1907, "place": "Iisalmi"},
    "FI75": {"lat": 63.3807, "lng": 28.6188, "place": "Ylä-Luosta"},
    "FI76": {"lat": 62.1579, "lng": 27.1993, "place": "Pieksämäki"},
    "FI77": {"lat": 62.3293, "lng": 26.8998, "place": "Paltanen"},
    "FI78": {"lat": 62.2603, "lng": 27.9067, "place": "Kuvansi"},
    "FI79": {"lat": 62.4333, "lng": 28.6, "place": "Heinävesi"},
    "FI80": {"lat": 62.5947, "lng": 29.8359, "place": "Joensuu"},
    "FI81": {"lat": 62.7602, "lng": 29.8471, "place": "Kontiolahti"},
    "FI82": {"lat": 62.4214, "lng": 30.379, "place": "Huhtilampi"},
    "FI83": {"lat": 62.6803, "lng": 29.4759, "place": "Vaivio"},
    "FI84": {"lat": 64.0601, "lng": 24.688, "place": "Ylivieska"},
    "FI85": {"lat": 63.9347, "lng": 24.8664, "place": "Nivala"},
    "FI86": {"lat": 64.4667, "lng": 24.2333, "place": "Pyhäjoki"},
    "FI87": {"lat": 64.3592, "lng": 28.1485, "place": "Kajaani"},
    "FI88": {"lat": 64.313, "lng": 29.0999, "place": "Ylä-Vieksi"},
    "FI89": {"lat": 64.871, "lng": 27.6823, "place": "Puolanka"},
    "FI90": {"lat": 65.0124, "lng": 25.4682, "place": "Oulu"},
    "FI91": {"lat": 64.8176, "lng": 26.0221, "place": "Muhos"},
    "FI92": {"lat": 64.6522, "lng": 24.4364, "place": "Raahe"},
    "FI93": {"lat": 65.5067, "lng": 26.4079, "place": "Ala-Siurua"},
    "FI94": {"lat": 65.7364, "lng": 24.5637, "place": "Kemi"},
    "FI95": {"lat": 65.6667, "lng": 25.05, "place": "Simo"},
    "FI96": {"lat": 66.5, "lng": 25.7167, "place": "Rovaniemi"},
    "FI97": {"lat": 66.4175, "lng": 25.4972, "place": "Rautiosaari"},
    "FI98": {"lat": 66.7131, "lng": 27.4306, "place": "Kemijärvi"},
    "FI99": {"lat": 68.0745, "lng": 29.3268, "place": "Korvatunturi"},
    "FR01": {"lat": 46.3744, "lng": 5.9733, "place": "Lajoux"},
    "FR02": {"lat": 49.5285, "lng": 3.5398, "place": "Bourguignon-sous-Montbavin"},
    "FR03": {"lat": 46.5506, "lng": 3.2559, "place": "Coulandon"},
    "FR04": {"lat": 44.1667, "lng": 6.2167, "place": "La Robine-sur-Galabre"},
    "FR05": {"lat": 44.3175, "lng": 5.611, "place": "Villebois-les-Pins"},
    "FR06": {"lat": 43.9151, "lng": 6.8905, "place": "La Rochette"},
    "FR07": {"lat": 44.7348, "lng": 4.6206, "place": "Coux"},
    "FR08": {"lat": 49.7752, "lng": 4.6817, "place": "Warcq"},
    "FR09": {"lat": 42.9692, "lng": 1.5187, "place": "Serres-sur-Arget"},
    "FR10": {"lat": 48.3007, "lng": 4.0852, "place": "Troyes"},
    "FR11": {"lat": 43.2165, "lng": 2.3486, "place": "Carcassonne"},
    "FR12": {"lat": 44.3526, "lng": 2.5734, "place": "Rodez"},
    "FR13": {"lat": 43.2969, "lng": 5.3811, "place": "Marseille"},
    "FR14": {"lat": 49.1859, "lng": -0.3591, "place": "Caen"},
    "FR15": {"lat": 44.959, "lng": 2.4188, "place": "Naucelles"},
    "FR16": {"lat": 45.65, "lng": 0.1534, "place": "Angoulême"},
    "FR17": {"lat": 46.1631, "lng": -1.1522, "place": "La Rochelle"},
    "FR18": {"lat": 47.0833, "lng": 2.4, "place": "Bourges"},
    "FR19": {"lat": 45.2658, "lng": 1.7723, "place": "Tulle"},
    "FR20": {"lat": 41.9189, "lng": 8.7381, "place": "Ajaccio"},
    "FR21": {"lat": 47.3167, "lng": 5.0167, "place": "Dijon"},
    "FR22": {"lat": 48.5151, "lng": -2.7684, "place": "Saint-Brieuc"},
    "FR23": {"lat": 46.1515, "lng": 1.8132, "place": "Saint-Léger-le-Guérétois"},
    "FR24": {"lat": 45.1869, "lng": 0.7144, "place": "Périgueux"},
    "FR25": {"lat": 47.2488, "lng": 6.0182, "place": "Besançon"},
    "FR26": {"lat": 44.9256, "lng": 4.9096, "place": "Valence"},
    "FR27": {"lat": 49.0241, "lng": 1.1508, "place": "Évreux"},
    "FR28": {"lat": 48.4469, "lng": 1.4892, "place": "Chartres"},
    "FR29": {"lat": 47.996, "lng": -4.098, "place": "Quimper"},
    "FR30": {"lat": 43.8366, "lng": 4.3579, "place": "Nîmes"},
    "FR31": {"lat": 43.6043, "lng": 1.4437, "place": "Toulouse"},
    "FR32": {"lat": 43.6456, "lng": 0.5886, "place": "Auch"},
    "FR33": {"lat": 44.8443, "lng": 0.2096, "place": "Port-Sainte-Foy-et-Ponchapt"},
    "FR34": {"lat": 43.6109, "lng": 3.8764, "place": "Montpellier"},
    "FR35": {"lat": 48.112, "lng": -1.6743, "place": "Rennes"},
    "FR36": {"lat": 46.8125, "lng": 1.6936, "place": "Châteauroux"},
    "FR37": {"lat": 47.3948, "lng": 0.704, "place": "Tours"},
    "FR38": {"lat": 45.1787, "lng": 5.7148, "place": "Grenoble"},
    "FR39": {"lat": 46.6754, "lng": 5.5557, "place": "Lons-le-Saunier"},
    "FR40": {"lat": 43.8902, "lng": -0.4971, "place": "Mont-de-Marsan"},
    "FR41": {"lat": 47.6, "lng": 1.2667, "place": "Saint-Sulpice-de-Pommeray"},
    "FR42": {"lat": 46.2018, "lng": 3.7797, "place": "Saint-Pierre-Laval"},
    "FR43": {"lat": 45.3133, "lng": 3.0715, "place": "Leyvaux"},
    "FR44": {"lat": 47.2173, "lng": -1.5534, "place": "Nantes"},
    "FR45": {"lat": 47.9029, "lng": 1.9039, "place": "Orléans"},
    "FR46": {"lat": 44.4491, "lng": 1.4366, "place": "Cahors"},
    "FR47": {"lat": 44.202, "lng": 0.6206, "place": "Agen"},
    "FR48": {"lat": 44.501, "lng": 3.5718, "place": "Lanuéjols"},
    "FR49": {"lat": 47.5486, "lng": -1.1227, "place": "Freigné"},
    "FR50": {"lat": 49.1349, "lng": -1.1388, "place": "Rampan"},
    "FR51": {"lat": 48.9539, "lng": 4.3672, "place": "Châlons-en-Champagne"},
    "FR52": {"lat": 48.6838, "lng": 4.8833, "place": "Saint-Eulien"},
    "FR53": {"lat": 48.0725, "lng": -0.7702, "place": "Laval"},
    "FR54": {"lat": 48.6844, "lng": 6.185, "place": "Nancy"},
    "FR55": {"lat": 48.8135, "lng": 5.2839, "place": "Érize-Saint-Dizier"},
    "FR56": {"lat": 47.6569, "lng": -2.762, "place": "Vannes"},
    "FR57": {"lat": 49.1191, "lng": 6.1727, "place": "Metz"},
    "FR58": {"lat": 46.9497, "lng": 3.1481, "place": "Challuy"},
    "FR59": {"lat": 50.633, "lng": 3.0586, "place": "Lille"},
    "FR60": {"lat": 49.4261, "lng": 2.0362, "place": "Goincourt"},
    "FR61": {"lat": 48.4221, "lng": 0.0619, "place": "Saint-Germain-du-Corbéis"},
    "FR62": {"lat": 50.139, "lng": 3.0324, "place": "Boursies"},
    "FR63": {"lat": 45.7797, "lng": 3.0868, "place": "Clermont-Ferrand"},
    "FR64": {"lat": 43.3112, "lng": -0.3558, "place": "Pau"},
    "FR65": {"lat": 43.2341, "lng": 0.0714, "place": "Tarbes"},
    "FR66": {"lat": 42.6976, "lng": 2.8954, "place": "Perpignan"},
    "FR67": {"lat": 48.5839, "lng": 7.7455, "place": "Strasbourg"},
    "FR68": {"lat": 48.0808, "lng": 7.3558, "place": "Colmar"},
    "FR69": {"lat": 45.7485, "lng": 4.8467, "place": "Lyon"},
    "FR70": {"lat": 47.6991, "lng": 6.19, "place": "Flagy"},
    "FR71": {"lat": 46.3393, "lng": 4.8305, "place": "Sancé"},
    "FR72": {"lat": 48.0021, "lng": 0.2025, "place": "Le Mans"},
    "FR73": {"lat": 45.4146, "lng": 5.8552, "place": "Saint-Pierre-d'Entremont"},
    "FR74": {"lat": 45.9088, "lng": 6.1256, "place": "Annecy"},
    "FR75": {"lat": 48.8534, "lng": 2.3488, "place": "Paris"},
    "FR76": {"lat": 49.4431, "lng": 1.0993, "place": "Rouen"},
    "FR77": {"lat": 48.5088, "lng": 2.6636, "place": "La Rochette"},
    "FR78": {"lat": 48.8036, "lng": 2.1342, "place": "Versailles"},
    "FR79": {"lat": 46.3231, "lng": -0.4588, "place": "Niort"},
    "FR80": {"lat": 49.9, "lng": 2.3, "place": "Amiens"},
    "FR81": {"lat": 43.9298, "lng": 2.148, "place": "Albi"},
    "FR82": {"lat": 44.0176, "lng": 1.3542, "place": "Montauban"},
    "FR83": {"lat": 43.1244, "lng": 5.9284, "place": "Toulon"},
    "FR84": {"lat": 43.9483, "lng": 4.8089, "place": "Avignon"},
    "FR85": {"lat": 46.7203, "lng": -1.4594, "place": "Mouilleron-le-Captif"},
    "FR86": {"lat": 46.5826, "lng": 0.3435, "place": "Poitiers"},
    "FR87": {"lat": 45.8336, "lng": 1.2476, "place": "Limoges"},
    "FR88": {"lat": 48.2017, "lng": 6.488, "place": "Jeuxey"},
    "FR89": {"lat": 47.8209, "lng": 3.5366, "place": "Perrigny"},
    "FR90": {"lat": 47.6422, "lng": 6.8539, "place": "Belfort"},
    "FR91": {"lat": 48.6328, "lng": 2.4405, "place": "Évry"},
    "FR92": {"lat": 48.892, "lng": 2.2067, "place": "Nanterre"},
    "FR93": {"lat": 48.9098, "lng": 2.4501, "place": "Bobigny"},
    "FR94": {"lat": 48.714, "lng": 2.3628, "place": "Paray-Vieille-Poste"},
    "FR95": {"lat": 49.0167, "lng": 2.0667, "place": "Neuville-sur-Oise"},
    "FR98": {"lat": 10.2922, "lng": -109.2072, "place": "Clipperton Island"},
    "IT00": {"lat": 41.90451037434743, "lng": 12.489532745711392, "place": "Rome"},
    "IT01": {"lat": 42.42135130290247, "lng": 12.104465175978358, "place": "Viterbo"},
    "IT02": {"lat": 42.41113, "lng": 12.85277, "place": "Rieti"},
    "IT03": {"lat": 41.63871, "lng": 13.33898, "place": "Frosinone"},
    "IT04": {"lat": 41.46759, "lng": 12.90474, "place": "Latina"},
    "IT05": {"lat": 42.56067, "lng": 12.64535, "place": "Terni"},
    "IT06": {"lat": 43.3608, "lng": 12.3235, "place": "Perugia"},
    "IT07": {"lat": 40.5807, "lng": 9.1113, "place": ""},
    "IT08": {"lat": 39.2071, "lng": 9.1074, "place": ""},
    "IT09": {"lat": 39.2071, "lng": 9.1074, "place": ""},
    "IT10": {"lat": 45.07132, "lng": 7.6872, "place": "Turin"},
    "IT11": {"lat": 45.7833, "lng": 6.95, "place": "Aosta"},
    "IT12": {"lat": 44.3962, "lng": 6.9382, "place": "Cuneo"},
    "IT13": {"lat": 45.6221, "lng": 8.0517, "place": "Vercelli/Biella"},
    "IT14": {"lat": 44.8334, "lng": 8.0635, "place": "Asti"},
    "IT15": {"lat": 44.6606, "lng": 8.3716, "place": "Alessandria"},
    "IT16": {"lat": 44.40883, "lng": 8.93482, "place": "Genoa"},
    "IT17": {"lat": 44.4479, "lng": 8.3941, "place": "Savona"},
    "IT18": {"lat": 43.852, "lng": 7.9314, "place": "Imperia"},
    "IT19": {"lat": 44.3367, "lng": 9.5359, "place": "La"},
    "IT20": {"lat": 45.45831, "lng": 9.1627, "place": "Milan/Monza/Brianza"},
    "IT21": {"lat": 45.6091, "lng": 8.7738, "place": "Varese"},
    "IT22": {"lat": 45.8087, "lng": 9.08532, "place": "Como"},
    "IT23": {"lat": 45.7954, "lng": 9.4376, "place": "Lecco/Sandrio"},
    "IT24": {"lat": 45.69483, "lng": 9.67092, "place": "Bergamo"},
    "IT25": {"lat": 45.47, "lng": 10.4791, "place": "Brescia"},
    "IT26": {"lat": 45.31317, "lng": 9.50311, "place": "Cremona/Lodi"},
    "IT27": {"lat": 45.306, "lng": 9.314, "place": "Pavia"},
    "IT28": {"lat": 45.4592, "lng": 8.511, "place": "Novara/Verbano-Cusio-Ossola"},
    "IT29": {"lat": 44.952, "lng": 9.7377, "place": "Piacenza"},
    "IT30": {"lat": 45.482, "lng": 12.23001, "place": "Venice"},
    "IT31": {"lat": 45.8279, "lng": 11.8336, "place": "Treviso"},
    "IT32": {"lat": 46.2812, "lng": 12.2958, "place": "Belluno"},
    "IT33": {"lat": 45.9509, "lng": 12.8425, "place": "Udine/Pordenone"},
    "IT34": {"lat": 45.908, "lng": 13.5165, "place": "Trieste/Gorizia"},
    "IT35": {"lat": 45.2375, "lng": 12.1695, "place": "Padua"},
    "IT36": {"lat": 45.796, "lng": 11.4452, "place": "Vicenza"},
    "IT37": {"lat": 45.43942, "lng": 10.99154, "place": "Verona"},
    "IT38": {"lat": 46.4078, "lng": 11.1393, "place": "Trento"},
    "IT39": {"lat": 46.6461, "lng": 11.17, "place": "Bolzano"},
    "IT40": {"lat": 44.49559, "lng": 11.3427, "place": "Bologna"},
    "IT41": {"lat": 44.2005, "lng": 10.7614, "place": "Modena"},
    "IT42": {"lat": 44.4003, "lng": 10.5318, "place": "Reggio"},
    "IT43": {"lat": 44.80334, "lng": 10.32902, "place": "Parma"},
    "IT44": {"lat": 44.566, "lng": 12.0776, "place": "Ferrara"},
    "IT45": {"lat": 44.9845, "lng": 12.0338, "place": "Rovigo"},
    "IT46": {"lat": 45.0461, "lng": 10.9337, "place": "Mantua"},
    "IT47": {"lat": 44.0796, "lng": 11.7414, "place": "Forli-Cesena/Rimini"},
    "IT48": {"lat": 44.4922, "lng": 11.8252, "place": "Ravenna"},
    "IT50": {"lat": 43.77056, "lng": 11.25836, "place": "Florence"},
    "IT51": {"lat": 43.9338, "lng": 10.7702, "place": "Pistoia"},
    "IT52": {"lat": 43.6297, "lng": 11.8545, "place": "Arezzo"},
    "IT53": {"lat": 43.436, "lng": 11.3068, "place": "Siena"},
    "IT54": {"lat": 44.2062, "lng": 9.942, "place": "Massa-Carrara"},
    "IT55": {"lat": 43.8989, "lng": 10.6374, "place": "Lucca"},
    "IT56": {"lat": 43.72411, "lng": 10.40167, "place": "Pisa"},
    "IT57": {"lat": 43.5242, "lng": 10.4595, "place": "Livorno"},
    "IT58": {"lat": 42.7039, "lng": 11.7378, "place": "Grosseto"},
    "IT59": {"lat": 43.8096, "lng": 10.9851, "place": "Prato"},
    "IT60": {"lat": 43.6262, "lng": 13.1307, "place": "Ancona"},
    "IT61": {"lat": 43.8878, "lng": 12.4778, "place": "Pesaro/Urbino"},
    "IT62": {"lat": 43.266, "lng": 13.3479, "place": "Macerata"},
    "IT63": {"lat": 42.888, "lng": 13.5551, "place": "Fermo"},
    "IT64": {"lat": 42.6546, "lng": 13.6038, "place": "Teramo"},
    "IT65": {"lat": 42.5228, "lng": 13.9707, "place": "Pescara"},
    "IT66": {"lat": 42.1556, "lng": 14.1943, "place": "Chieti"},
    "IT67": {"lat": 42.4501, "lng": 13.2806, "place": "L'Aquila"},
    "IT70": {"lat": 41.1013, "lng": 16.86929, "place": "Bari"},
    "IT71": {"lat": 41.9196, "lng": 15.8119, "place": "Foggia"},
    "IT72": {"lat": 40.63307, "lng": 17.9399, "place": "Brindisi"},
    "IT73": {"lat": 40.2202, "lng": 18.2275, "place": "Lecce"},
    "IT74": {"lat": 40.5286, "lng": 17.2012, "place": "Taranto"},
    "IT75": {"lat": 40.1884, "lng": 16.4248, "place": "Matera"},
    "IT76": {"lat": 40.78878, "lng": 17.11178, "place": "Barletta-Andria-Trani/Apulia"},
    "IT80": {"lat": 40.85173, "lng": 14.25511, "place": "Naples"},
    "IT81": {"lat": 41.4645, "lng": 14.225, "place": "Caserta"},
    "IT82": {"lat": 41.0653, "lng": 14.7928, "place": "Benevento"},
    "IT83": {"lat": 40.9487, "lng": 14.7446, "place": "Avellino"},
    "IT84": {"lat": 40.6503, "lng": 14.6268, "place": "Salerno"},
    "IT85": {"lat": 40.5659, "lng": 16.0725, "place": "Potenza"},
    "IT86": {"lat": 41.5574, "lng": 14.7444, "place": "Campobasso/Isernia"},
    "IT87": {"lat": 39.6875, "lng": 16.0493, "place": "Cosenza"},
    "IT88": {"lat": 38.8465, "lng": 16.3798, "place": "Catenzaro/Crotone"},
    "IT89": {"lat": 38.3217, "lng": 16.0075, "place": "ReggioCalabria/Vibo"},
    "IT90": {"lat": 37.975, "lng": 13.9342, "place": ""},
    "IT91": {"lat": 38.0719, "lng": 12.7595, "place": ""},
    "IT92": {"lat": 37.6009, "lng": 13.2883, "place": ""},
    "IT93": {"lat": 37.6546, "lng": 13.8445, "place": ""},
    "IT94": {"lat": 37.6823, "lng": 14.2323, "place": ""},
    "IT95": {"lat": 37.7359, "lng": 15.1127, "place": ""},
    "IT96": {"lat": 37.1588, "lng": 15.03, "place": ""},
    "IT97": {"lat": 36.7165, "lng": 14.7847, "place": ""},
    "IT98": {"lat": 37.9855, "lng": 15.3597, "place": ""},
    "LVLV": {"lat": 56.6048, "lng": 25.2553, "place": "Aizkraukles stacija"},
    "NL10": {"lat": 52.371, "lng": 4.9042, "place": "Amsterdam"},
    "NL11": {"lat": 52.3099, "lng": 4.8631, "place": "Amstelveen"},
    "NL12": {"lat": 50.7859, "lng": 5.9923, "place": "Lemiers"},
    "NL13": {"lat": 52.3046, "lng": 5.0444, "place": "Weesp"},
    "NL14": {"lat": 52.2631, "lng": 4.758, "place": "Aalsmeer"},
    "NL15": {"lat": 52.5301, "lng": 4.7811, "place": "Markenbinnen"},
    "NL16": {"lat": 52.6005, "lng": 4.889, "place": "Schermerhorn"},
    "NL17": {"lat": 52.7554, "lng": 4.6513, "place": "Schoorl"},
    "NL18": {"lat": 52.631, "lng": 4.7486, "place": "Alkmaar"},
    "NL19": {"lat": 51.8907, "lng": 5.4149, "place": "Tiel"},
    "NL20": {"lat": 52.3923, "lng": 4.6094, "place": "Overveen"},
    "NL21": {"lat": 52.3638, "lng": 4.595, "place": "Aerdenhout"},
    "NL22": {"lat": 52.2086, "lng": 4.4203, "place": "Katwijk"},
    "NL23": {"lat": 52.2008, "lng": 5.374, "place": "Amersfoort"},
    "NL24": {"lat": 52.1503, "lng": 4.6534, "place": "Alphen aan den Rijn"},
    "NL25": {"lat": 52.078, "lng": 4.3175, "place": "s-Gravenhage"},
    "NL26": {"lat": 52.0115, "lng": 4.3595, "place": "Delft"},
    "NL27": {"lat": 52.0768, "lng": 4.5476, "place": "Benthuizen"},
    "NL28": {"lat": 52.0119, "lng": 4.7079, "place": "Gouda"},
    "NL29": {"lat": 51.9482, "lng": 4.9309, "place": "Tienhoven aan de Lek"},
    "NL30": {"lat": 51.9191, "lng": 4.4867, "place": "Rotterdam"},
    "NL31": {"lat": 51.9202, "lng": 4.2622, "place": "Maassluis"},
    "NL32": {"lat": 51.7588, "lng": 4.1684, "place": "Middelharnis"},
    "NL33": {"lat": 51.8131, "lng": 4.6685, "place": "Dordrecht"},
    "NL34": {"lat": 52.0073, "lng": 4.9781, "place": "Benschop"},
    "NL35": {"lat": 52.0886, "lng": 5.1174, "place": "Utrecht"},
    "NL36": {"lat": 52.1767, "lng": 5.0692, "place": "Breukeleveen"},
    "NL37": {"lat": 52.1472, "lng": 5.5878, "place": "Barneveld"},
    "NL38": {"lat": 52.2474, "lng": 5.778, "place": "Uddel"},
    "NL39": {"lat": 52.0804, "lng": 5.4889, "place": "Scherpenzeel"},
    "NL40": {"lat": 51.9168, "lng": 5.4085, "place": "Zoelen"},
    "NL41": {"lat": 51.942, "lng": 5.3092, "place": "Zoelmond"},
    "NL42": {"lat": 51.8559, "lng": 5.0128, "place": "Spijk"},
    "NL43": {"lat": 51.4996, "lng": 3.6143, "place": "Middelburg"},
    "NL44": {"lat": 51.4592, "lng": 3.9035, "place": "s-Gravenpolder"},
    "NL45": {"lat": 51.2842, "lng": 4.0536, "place": "Hulst"},
    "NL46": {"lat": 51.4949, "lng": 4.2862, "place": "Bergen op Zoom"},
    "NL47": {"lat": 51.5498, "lng": 4.5892, "place": "St. Willebrord"},
    "NL48": {"lat": 51.5878, "lng": 4.7756, "place": "Breda"},
    "NL49": {"lat": 51.6609, "lng": 4.8379, "place": "Geertruidenberg"},
    "NL50": {"lat": 51.5214, "lng": 5.0638, "place": "Goirle"},
    "NL51": {"lat": 51.4358, "lng": 4.9306, "place": "Baarle-Nassau"},
    "NL52": {"lat": 51.5856, "lng": 5.3206, "place": "Boxtel"},
    "NL53": {"lat": 51.7484, "lng": 5.2596, "place": "Hedel"},
    "NL54": {"lat": 51.6029, "lng": 5.6779, "place": "Boekel"},
    "NL55": {"lat": 51.3969, "lng": 5.3456, "place": "Knegsel"},
    "NL56": {"lat": 51.5206, "lng": 5.4084, "place": "Best"},
    "NL57": {"lat": 51.4433, "lng": 5.8846, "place": "Griendtsveen"},
    "NL58": {"lat": 51.6357, "lng": 6.0165, "place": "Afferden L"},
    "NL59": {"lat": 51.2831, "lng": 6.079, "place": "Reuver"},
    "NL60": {"lat": 51.2856, "lng": 5.7476, "place": "Nederweert"},
    "NL61": {"lat": 50.94, "lng": 5.8392, "place": "Spaubeek"},
    "NL62": {"lat": 50.8503, "lng": 5.6882, "place": "Maastricht"},
    "NL63": {"lat": 50.9014, "lng": 6.0158, "place": "Landgraaf"},
    "NL64": {"lat": 50.9499, "lng": 5.9666, "place": "Brunssum"},
    "NL65": {"lat": 51.8555, "lng": 5.8132, "place": "Weurt"},
    "NL66": {"lat": 51.8605, "lng": 5.7675, "place": "Beuningen Gld"},
    "NL67": {"lat": 52.0409, "lng": 5.6758, "place": "Ede"},
    "NL68": {"lat": 51.9814, "lng": 5.9064, "place": "Arnhem"},
    "NL69": {"lat": 52.1035, "lng": 6.0562, "place": "Eerbeek"},
    "NL70": {"lat": 51.8644, "lng": 6.4869, "place": "Dinxperlo"},
    "NL71": {"lat": 51.9257, "lng": 6.5917, "place": "Aalten"},
    "NL72": {"lat": 52.1682, "lng": 6.2273, "place": "Eefde"},
    "NL73": {"lat": 52.2131, "lng": 5.9615, "place": "Apeldoorn"},
    "NL74": {"lat": 52.2454, "lng": 6.1479, "place": "Steenenkamer"},
    "NL75": {"lat": 52.8874, "lng": 6.9326, "place": "2e Exloërmond"},
    "NL76": {"lat": 52.3455, "lng": 6.6715, "place": "Almelo"},
    "NL77": {"lat": 52.666, "lng": 6.7352, "place": "Coevorden"},
    "NL78": {"lat": 52.7697, "lng": 6.8015, "place": "Sleen"},
    "NL79": {"lat": 52.7285, "lng": 6.6275, "place": "Geesbrug"},
    "NL80": {"lat": 52.4144, "lng": 5.8135, "place": "Doornspijk"},
    "NL81": {"lat": 52.3473, "lng": 5.9924, "place": "Epe"},
    "NL82": {"lat": 52.557, "lng": 5.9168, "place": "Kampen"},
    "NL83": {"lat": 52.8236, "lng": 6.2205, "place": "Wapserveen"},
    "NL84": {"lat": 52.9208, "lng": 6.2538, "place": "Zorgvlied"},
    "NL85": {"lat": 52.9511, "lng": 5.6582, "place": "Koufurderrige"},
    "NL86": {"lat": 53.0326, "lng": 5.6504, "place": "Sneek"},
    "NL87": {"lat": 53.1256, "lng": 5.5879, "place": "Jorwert"},
    "NL88": {"lat": 53.1964, "lng": 5.4589, "place": "Wijnaldum"},
    "NL89": {"lat": 53.2016, "lng": 5.7969, "place": "Leeuwarden"},
    "NL90": {"lat": 53.0932, "lng": 5.8372, "place": "Grou"},
    "NL91": {"lat": 53.4437, "lng": 5.6386, "place": "Hollum"},
    "NL92": {"lat": 53.181, "lng": 6.1686, "place": "Surhuisterveen"},
    "NL93": {"lat": 53.1383, "lng": 6.4234, "place": "Roden"},
    "NL94": {"lat": 52.9939, "lng": 6.5625, "place": "Assen"},
    "NL95": {"lat": 53.0251, "lng": 6.8381, "place": "Gieterveen"},
    "NL96": {"lat": 53.0788, "lng": 6.8, "place": "Annerveenschekanaal"},
    "NL97": {"lat": 53.1938, "lng": 6.4509, "place": "Matsloot"},
    "NL98": {"lat": 53.2388, "lng": 6.2152, "place": "Stroobos"},
    "NL99": {"lat": 53.2237, "lng": 6.9482, "place": "t Waar"},
    "NO00": {"lat": 59.9127, "lng": 10.7461, "place": "Oslo"},
    "NO01": {"lat": 59.9127, "lng": 10.7461, "place": "Oslo"},
    "NO02": {"lat": 59.9127, "lng": 10.7461, "place": "Oslo"},
    "NO03": {"lat": 59.9127, "lng": 10.7461, "place": "Oslo"},
    "NO04": {"lat": 59.9127, "lng": 10.7461, "place": "Oslo"},
    "NO05": {"lat": 59.9127, "lng": 10.7461, "place": "Oslo"},
    "NO06": {"lat": 59.9127, "lng": 10.7461, "place": "Oslo"},
    "NO07": {"lat": 59.9127, "lng": 10.7461, "place": "Oslo"},
    "NO08": {"lat": 59.9127, "lng": 10.7461, "place": "Oslo"},
    "NO09": {"lat": 59.9127, "lng": 10.7461, "place": "Oslo"},
    "NO10": {"lat": 59.9127, "lng": 10.7461, "place": "Oslo"},
    "NO11": {"lat": 59.9127, "lng": 10.7461, "place": "Oslo"},
    "NO12": {"lat": 59.9127, "lng": 10.7461, "place": "Oslo"},
    "NO13": {"lat": 59.8979, "lng": 10.4906, "place": "Sandvika"},
    "NO14": {"lat": 59.9535, "lng": 11.0029, "place": "Strømmen"},
    "NO15": {"lat": 59.5827, "lng": 10.8441, "place": "Vestby"},
    "NO16": {"lat": 59.2131, "lng": 10.9556, "place": "Fredrikstad"},
    "NO17": {"lat": 59.1864, "lng": 11.3393, "place": "Halden"},
    "NO18": {"lat": 59.4683, "lng": 11.1635, "place": "Skiptvet"},
    "NO19": {"lat": 59.9305, "lng": 11.1667, "place": "Fetsund"},
    "NO20": {"lat": 59.9481, "lng": 11.112, "place": "Lillestrøm"},
    "NO21": {"lat": 60.3436, "lng": 11.6484, "place": "Årnes"},
    "NO22": {"lat": 60.1905, "lng": 11.9977, "place": "Kongsvinger"},
    "NO23": {"lat": 60.7945, "lng": 11.068, "place": "Hamar"},
    "NO24": {"lat": 60.7247, "lng": 11.802, "place": "Braskereidfoss"},
    "NO25": {"lat": 62.409, "lng": 10.9988, "place": "Tolga"},
    "NO26": {"lat": 61.1151, "lng": 10.4663, "place": "Lillehammer"},
    "NO27": {"lat": 60.3957, "lng": 10.5402, "place": "Grindvoll"},
    "NO28": {"lat": 60.7957, "lng": 10.6915, "place": "Gjøvik"},
    "NO29": {"lat": 60.8225, "lng": 9.5521, "place": "Bagn"},
    "NO30": {"lat": 59.7491, "lng": 10.1985, "place": "Drammen"},
    "NO31": {"lat": 59.3507, "lng": 10.4601, "place": "Åsgårdstrand"},
    "NO32": {"lat": 59.1309, "lng": 10.2269, "place": "Sandefjord"},
    "NO33": {"lat": 59.7669, "lng": 9.9171, "place": "Hokksund"},
    "NO34": {"lat": 59.7386, "lng": 10.3376, "place": "Spikkestad"},
    "NO35": {"lat": 60.2802, "lng": 10.3923, "place": "Jevnaker"},
    "NO36": {"lat": 59.6509, "lng": 9.6655, "place": "Kongsberg"},
    "NO37": {"lat": 59.1931, "lng": 9.5942, "place": "Skien"},
    "NO38": {"lat": 59.274, "lng": 9.2796, "place": "Ulefoss"},
    "NO39": {"lat": 59.1569, "lng": 9.6628, "place": "Porsgrunn"},
    "NO40": {"lat": 58.9701, "lng": 5.7333, "place": "Stavanger"},
    "NO41": {"lat": 59.0476, "lng": 5.7013, "place": "Rennesøy"},
    "NO42": {"lat": 59.4847, "lng": 6.2511, "place": "Sand"},
    "NO43": {"lat": 58.4513, "lng": 5.9997, "place": "Egersund"},
    "NO44": {"lat": 58.4567, "lng": 6.5518, "place": "Moi"},
    "NO45": {"lat": 58.0274, "lng": 7.4534, "place": "Mandal"},
    "NO46": {"lat": 58.1467, "lng": 7.9956, "place": "Kristiansand S"},
    "NO47": {"lat": 58.1712, "lng": 8.2459, "place": "Høvåg"},
    "NO48": {"lat": 58.3782, "lng": 8.676, "place": "Fevik"},
    "NO49": {"lat": 58.7206, "lng": 9.2342, "place": "Risør"},
    "NO50": {"lat": 60.393, "lng": 5.3242, "place": "Bergen"},
    "NO51": {"lat": 60.5183, "lng": 5.2997, "place": "Hordvik"},
    "NO52": {"lat": 60.3182, "lng": 5.3532, "place": "Nesttun"},
    "NO53": {"lat": 60.1308, "lng": 5.0888, "place": "Bakkasund"},
    "NO54": {"lat": 59.8156, "lng": 5.2682, "place": "Rubbestadneset"},
    "NO55": {"lat": 59.4138, "lng": 5.268, "place": "Haugesund"},
    "NO56": {"lat": 60.05, "lng": 5.55, "place": "Tysnes"},
    "NO57": {"lat": 60.0691, "lng": 6.5457, "place": "Odda"},
    "NO58": {"lat": 60.393, "lng": 5.3242, "place": "Bergen"},
    "NO59": {"lat": 60.5552, "lng": 5.2694, "place": "Isdalstø"},
    "NO60": {"lat": 62.4723, "lng": 6.1549, "place": "Ålesund"},
    "NO61": {"lat": 62.143, "lng": 5.814, "place": "Syvde"},
    "NO62": {"lat": 62.4355, "lng": 6.734, "place": "Ørskog"},
    "NO63": {"lat": 62.6745, "lng": 7.5646, "place": "Vistdal"},
    "NO64": {"lat": 62.7375, "lng": 7.1591, "place": "Molde"},
    "NO65": {"lat": 63.0243, "lng": 7.8065, "place": "Kristiansund N"},
    "NO66": {"lat": 62.8946, "lng": 7.6725, "place": "Batnfjordsøra"},
    "NO67": {"lat": 61.9692, "lng": 6.5242, "place": "Hornindal"},
    "NO68": {"lat": 61.163, "lng": 6.6792, "place": "Vik I Sogn"},
    "NO69": {"lat": 61.5996, "lng": 5.0328, "place": "Florø"},
    "NO70": {"lat": 63.4305, "lng": 10.3951, "place": "Trondheim"},
    "NO71": {"lat": 63.5837, "lng": 9.9599, "place": "Rissa"},
    "NO72": {"lat": 63.7252, "lng": 8.8332, "place": "Sistranda"},
    "NO73": {"lat": 62.5943, "lng": 9.6912, "place": "Oppdal"},
    "NO74": {"lat": 63.4305, "lng": 10.3951, "place": "Trondheim"},
    "NO75": {"lat": 63.2976, "lng": 10.4826, "place": "Klæbu"},
    "NO76": {"lat": 63.5891, "lng": 10.7423, "place": "Frosta"},
    "NO77": {"lat": 64.0149, "lng": 11.4954, "place": "Steinkjer"},
    "NO78": {"lat": 64.4662, "lng": 11.4957, "place": "Namsos"},
    "NO79": {"lat": 65.087, "lng": 12.3715, "place": "Terråk"},
    "NO80": {"lat": 67.28, "lng": 14.405, "place": "Bodø"},
    "NO81": {"lat": 67.1187, "lng": 14.9992, "place": "Misvær"},
    "NO82": {"lat": 67.1002, "lng": 15.3909, "place": "Rognan"},
    "NO83": {"lat": 68.0899, "lng": 13.2299, "place": "Ramberg"},
    "NO84": {"lat": 68.4137, "lng": 15.9963, "place": "Lødingen"},
    "NO85": {"lat": 68.4384, "lng": 17.4272, "place": "Narvik"},
    "NO86": {"lat": 65.836, "lng": 13.1908, "place": "Mosjøen"},
    "NO87": {"lat": 66.1982, "lng": 13.0184, "place": "Nesna"},
    "NO88": {"lat": 65.7252, "lng": 12.5981, "place": "Visthus"},
    "NO89": {"lat": 65.3167, "lng": 12.1667, "place": "Sømna"},
    "NO90": {"lat": 69.6693, "lng": 18.9669, "place": "Tromsø"},
    "NO91": {"lat": 70.2326, "lng": 21.2338, "place": "Andsnes"},
    "NO92": {"lat": 69.6342, "lng": 18.9225, "place": "Tromsø"},
    "NO93": {"lat": 68.7523, "lng": 17.789, "place": "Tennevoll"},
    "NO94": {"lat": 68.8991, "lng": 16.5722, "place": "Lundenes"},
    "NO95": {"lat": 69.9706, "lng": 23.2866, "place": "Alta"},
    "NO96": {"lat": 70.6628, "lng": 23.6818, "place": "Hammerfest"},
    "NO97": {"lat": 69.46, "lng": 25.453, "place": "Karasjok"},
    "NO98": {"lat": 70.0878, "lng": 29.798, "place": "Vadsø"},
    "NO99": {"lat": 69.7197, "lng": 30.1604, "place": "Kirkenes"},
    "PL00": {"lat": 52.8978, "lng": 21.0982, "place": "Budzyno"},
    "PL01": {"lat": 52.243, "lng": 20.992, "place": "Warszawa"},
    "PL02": {"lat": 52.2269, "lng": 20.9997, "place": "Warszawa"},
    "PL03": {"lat": 52.3432, "lng": 20.9859, "place": "Warszawa"},
    "PL04": {"lat": 53.0545, "lng": 21.5572, "place": "Dzbenin"},
    "PL05": {"lat": 51.747, "lng": 20.946, "place": "Pelinów"},
    "PL06": {"lat": 52.8851, "lng": 20.4627, "place": "Chotum"},
    "PL07": {"lat": 53.0328, "lng": 21.6661, "place": "Drwęcz"},
    "PL08": {"lat": 51.6618, "lng": 21.8891, "place": "Stara Dąbia"},
    "PL09": {"lat": 52.42, "lng": 19.5113, "place": "Gaśno"},
    "PL10": {"lat": 53.8337, "lng": 20.575, "place": "Szypry"},
    "PL11": {"lat": 54.1584, "lng": 20.8712, "place": "Galinki"},
    "PL12": {"lat": 53.8211, "lng": 22.1638, "place": "Rożyńsk"},
    "PL13": {"lat": 53.2125, "lng": 20.1144, "place": "Prusinowo"},
    "PL14": {"lat": 54.1551, "lng": 19.8162, "place": "Bronki"},
    "PL15": {"lat": 53.0766, "lng": 23.1353, "place": "Hryniewicze"},
    "PL16": {"lat": 53.9139, "lng": 22.7851, "place": "Chomontowo"},
    "PL17": {"lat": 52.735, "lng": 23.0764, "place": "Bolesty"},
    "PL18": {"lat": 52.9985, "lng": 22.8291, "place": "Płonka Kościelna"},
    "PL19": {"lat": 53.3359, "lng": 23.1345, "place": "Brzozówka Koronna"},
    "PL20": {"lat": 51.2512, "lng": 22.4768, "place": "Szerokie"},
    "PL21": {"lat": 52.0631, "lng": 22.7402, "place": "Dołhołęka"},
    "PL22": {"lat": 51.0684, "lng": 23.5001, "place": "Rożdżałów"},
    "PL23": {"lat": 50.5548, "lng": 22.6798, "place": "Zagumnie"},
    "PL24": {"lat": 51.3184, "lng": 22.3207, "place": "Ługów"},
    "PL25": {"lat": 50.7159, "lng": 20.4255, "place": "Brzeźno"},
    "PL26": {"lat": 51.376, "lng": 20.3171, "place": "Różanna"},
    "PL27": {"lat": 51.1551, "lng": 21.5368, "place": "Zofiówka"},
    "PL28": {"lat": 50.4981, "lng": 20.6805, "place": "Nowy Folwark"},
    "PL29": {"lat": 50.7929, "lng": 20.0829, "place": "Przygradów"},
    "PL30": {"lat": 49.7005, "lng": 21.2087, "place": "Klęczany"},
    "PL31": {"lat": 49.9629, "lng": 19.7615, "place": "Zelczyna"},
    "PL32": {"lat": 49.9854, "lng": 20.3509, "place": "Stanisławice"},
    "PL33": {"lat": 50.2521, "lng": 21.0231, "place": "Wola Mędrzechowska"},
    "PL34": {"lat": 49.6432, "lng": 20.4321, "place": "Siekierczyna"},
    "PL35": {"lat": 49.9823, "lng": 22.7543, "place": "Tuczempy"},
    "PL36": {"lat": 49.6517, "lng": 22.0808, "place": "Grabownica Starzeńska"},
    "PL37": {"lat": 50.0003, "lng": 22.574, "place": "Cieszacin Mały"},
    "PL38": {"lat": 49.5884, "lng": 21.1159, "place": "Bielanka"},
    "PL39": {"lat": 50.1007, "lng": 21.4856, "place": "Brzeźnica"},
    "PL40": {"lat": 49.8549, "lng": 19.0621, "place": "Bielsko-Biała"},
    "PL41": {"lat": 50.3165, "lng": 19.0723, "place": "Czeladź"},
    "PL42": {"lat": 50.4513, "lng": 19.1255, "place": "Mierzęcice"},
    "PL43": {"lat": 50.4165, "lng": 19.1334, "place": "Toporowice"},
    "PL44": {"lat": 50.433, "lng": 18.4593, "place": "Niekarmia"},
    "PL45": {"lat": 50.6637, "lng": 17.9413, "place": "Opole"},
    "PL46": {"lat": 51.0032, "lng": 18.1651, "place": "Smardy Górne"},
    "PL47": {"lat": 50.1132, "lng": 18.0556, "place": "Tłustomosty"},
    "PL48": {"lat": 50.1415, "lng": 17.8241, "place": "Bogdanowice-Kolonia"},
    "PL49": {"lat": 50.8598, "lng": 17.44, "place": "Brzeg"},
    "PL50": {"lat": 51.2677, "lng": 15.7679, "place": "Okmiany"},
    "PL51": {"lat": 51.3453, "lng": 16.8458, "place": "Osolin"},
    "PL52": {"lat": 50.697, "lng": 16.5701, "place": "Pieszyce"},
    "PL53": {"lat": 51.5873, "lng": 16.3522, "place": "Orsk"},
    "PL54": {"lat": 51.0312, "lng": 17.0395, "place": "Biestrzyków"},
    "PL55": {"lat": 51.5851, "lng": 16.3505, "place": "Orsk"},
    "PL56": {"lat": 51.7161, "lng": 16.6268, "place": "Czernina Górna"},
    "PL57": {"lat": 50.2564, "lng": 16.8922, "place": "Bolesławów"},
    "PL58": {"lat": 50.7562, "lng": 16.614, "place": "Nowizna"},
    "PL59": {"lat": 51.3504, "lng": 15.5852, "place": "Golnice"},
    "PL60": {"lat": 52.393, "lng": 16.7873, "place": "Skórzewo"},
    "PL61": {"lat": 52.5352, "lng": 17.6342, "place": "Gniezno"},
    "PL62": {"lat": 52.512, "lng": 17.5985, "place": "Gniezno"},
    "PL63": {"lat": 51.883, "lng": 16.9002, "place": "Płaczkowo"},
    "PL64": {"lat": 52.9459, "lng": 16.7684, "place": "Drzązgowo"},
    "PL65": {"lat": 51.9427, "lng": 15.5117, "place": "Zielona Góra"},
    "PL66": {"lat": 52.7547, "lng": 15.2903, "place": "Wawrów"},
    "PL67": {"lat": 51.6156, "lng": 16.1192, "place": "Turów"},
    "PL68": {"lat": 51.8056, "lng": 15.7078, "place": "Nowa Sól"},
    "PL69": {"lat": 52.4307, "lng": 14.5965, "place": "Pławidło"},
    "PL70": {"lat": 53.438, "lng": 14.7327, "place": "Załom"},
    "PL71": {"lat": 53.4588, "lng": 14.4571, "place": "Bezrzecze"},
    "PL72": {"lat": 53.6396, "lng": 14.7819, "place": "Wierzchosław"},
    "PL73": {"lat": 53.1306, "lng": 15.4517, "place": "Stary Klukom"},
    "PL74": {"lat": 53.2841, "lng": 14.5167, "place": "Czepino"},
    "PL75": {"lat": 54.2271, "lng": 16.2018, "place": "Skwierzynka"},
    "PL76": {"lat": 54.4164, "lng": 17.581, "place": "Mikorowo"},
    "PL77": {"lat": 54.1731, "lng": 17.4945, "place": "Bytów"},
    "PL78": {"lat": 53.9514, "lng": 16.0594, "place": "Przegonia"},
    "PL80": {"lat": 54.3219, "lng": 18.5141, "place": "Otomin"},
    "PL81": {"lat": 54.5987, "lng": 18.5032, "place": "Pierwoszyno"},
    "PL82": {"lat": 54.117, "lng": 17.9628, "place": "Kościerzyna"},
    "PL83": {"lat": 54.2674, "lng": 17.7128, "place": "Folwark"},
    "PL84": {"lat": 54.4149, "lng": 18.3169, "place": "Czeczewo"},
    "PL85": {"lat": 53.2551, "lng": 17.4449, "place": "Jeziorki Zabartowskie"},
    "PL86": {"lat": 53.0928, "lng": 17.8493, "place": "Murowaniec"},
    "PL87": {"lat": 52.8768, "lng": 18.6513, "place": "Służewo-Pole"},
    "PL88": {"lat": 52.7867, "lng": 18.2609, "place": "Inowrocław"},
    "PL89": {"lat": 53.0758, "lng": 18.2521, "place": "Solec Kujawski"},
    "PL90": {"lat": 51.7113, "lng": 19.627, "place": "Wiśniowa Góra"},
    "PL91": {"lat": 51.8509, "lng": 19.3646, "place": "Zgierz"},
    "PL92": {"lat": 51.8291, "lng": 19.5684, "place": "Kalonka"},
    "PL93": {"lat": 51.1474, "lng": 19.037, "place": "Siedlec"},
    "PL94": {"lat": 51.7485, "lng": 19.4156, "place": "Łódź"},
    "PL95": {"lat": 51.666, "lng": 19.6839, "place": "Kurowice"},
    "PL96": {"lat": 51.8071, "lng": 20.2169, "place": "Stary Dwór"},
    "PL97": {"lat": 51.3326, "lng": 19.361, "place": "Poręby"},
    "PL98": {"lat": 51.6393, "lng": 19.0282, "place": "Borszewice Cmentarne"},
    "PL99": {"lat": 52.186, "lng": 19.3174, "place": "Leszno"},
    "PT10": {"lat": 38.7167, "lng": -9.1333, "place": "Lisboa"},
    "PT11": {"lat": 38.7167, "lng": -9.1333, "place": "Lisboa"},
    "PT12": {"lat": 38.7167, "lng": -9.1333, "place": "Lisboa"},
    "PT13": {"lat": 38.7167, "lng": -9.1333, "place": "Lisboa"},
    "PT14": {"lat": 38.7167, "lng": -9.1333, "place": "Lisboa"},
    "PT15": {"lat": 38.7167, "lng": -9.1333, "place": "Lisboa"},
    "PT16": {"lat": 38.7167, "lng": -9.1333, "place": "Lisboa"},
    "PT17": {"lat": 38.7167, "lng": -9.1333, "place": "Lisboa"},
    "PT18": {"lat": 38.7167, "lng": -9.1333, "place": "Lisboa"},
    "PT19": {"lat": 38.7167, "lng": -9.1333, "place": "Lisboa"},
    "PT20": {"lat": 39.0703, "lng": -8.8682, "place": "Azambuja"},
    "PT21": {"lat": 38.9792, "lng": -8.8076, "place": "Benavente"},
    "PT22": {"lat": 39.4667, "lng": -8.2, "place": "Abrantes"},
    "PT23": {"lat": 39.459, "lng": -8.6689, "place": "Marujo"},
    "PT24": {"lat": 39.7008, "lng": -8.9839, "place": "Água de Madeiros"},
    "PT25": {"lat": 39.2672, "lng": -9.158, "place": "Bombarral"},
    "PT26": {"lat": 38.9841, "lng": -9.0775, "place": "Arruda dos Vinhos"},
    "PT27": {"lat": 38.6979, "lng": -9.4215, "place": "Cascais"},
    "PT28": {"lat": 38.9209, "lng": -8.8838, "place": "Bela Vista"},
    "PT29": {"lat": 38.5958, "lng": -8.6495, "place": "Landeira"},
    "PT30": {"lat": 40.3107, "lng": -8.4253, "place": "Sargento Mor"},
    "PT31": {"lat": 40.1157, "lng": -8.4983, "place": "Condeixa-A-Nova"},
    "PT32": {"lat": 40.1167, "lng": -8.2492, "place": "Lousã"},
    "PT33": {"lat": 40.2183, "lng": -8.054, "place": "Arganil"},
    "PT34": {"lat": 40.3618, "lng": -7.8601, "place": "Oliveira do Hospital"},
    "PT35": {"lat": 40.8407, "lng": -7.535, "place": "Açores"},
    "PT36": {"lat": 40.8984, "lng": -7.4117, "place": "Guilheiro"},
    "PT37": {"lat": 40.5613, "lng": -8.3816, "place": "Zona Industrial En 1 Norte"},
    "PT38": {"lat": 40.6932, "lng": -8.4799, "place": "Albergaria-A-Velha"},
    "PT40": {"lat": 41.1496, "lng": -8.611, "place": "Porto"},
    "PT41": {"lat": 41.1496, "lng": -8.611, "place": "Porto"},
    "PT42": {"lat": 41.1496, "lng": -8.611, "place": "Porto"},
    "PT43": {"lat": 41.1496, "lng": -8.611, "place": "Porto"},
    "PT44": {"lat": 41.1551, "lng": -8.5041, "place": "São Pedro da Cova"},
    "PT45": {"lat": 40.9306, "lng": -8.2449, "place": "Arouca"},
    "PT46": {"lat": 41.3614, "lng": -8.1125, "place": "Agilde"},
    "PT47": {"lat": 41.6641, "lng": -8.3254, "place": "Vilela"},
    "PT48": {"lat": 41.5591, "lng": -8.0209, "place": "Refojos de Basto"},
    "PT49": {"lat": 41.6108, "lng": -8.7184, "place": "Aldreu"},
    "PT50": {"lat": 41.1947, "lng": -7.9235, "place": "Teixeira"},
    "PT51": {"lat": 41.2419, "lng": -7.3009, "place": "Carrazeda de Ansiães"},
    "PT52": {"lat": 41.4969, "lng": -6.2731, "place": "Miranda do Douro"},
    "PT53": {"lat": 41.3431, "lng": -6.9611, "place": "Valtelheiro"},
    "PT54": {"lat": 41.7042, "lng": -7.8217, "place": "Alturas do Barroso"},
    "PT60": {"lat": 39.8222, "lng": -7.4909, "place": "Castelo Branco"},
    "PT61": {"lat": 40.05, "lng": -7.7834, "place": "Bogas de Baixo"},
    "PT62": {"lat": 40.3593, "lng": -7.3487, "place": "Belmonte"},
    "PT63": {"lat": 40.2839, "lng": -7.1194, "place": "Alizo"},
    "PT64": {"lat": 40.936, "lng": -6.93, "place": "Figueira Castelo Rodrigo"},
    "PT70": {"lat": 38.7236, "lng": -7.9848, "place": "Arraiolos"},
    "PT71": {"lat": 38.8055, "lng": -7.4546, "place": "Borba"},
    "PT72": {"lat": 38.1345, "lng": -6.976, "place": "Barrancos"},
    "PT73": {"lat": 39.1224, "lng": -7.2862, "place": "Arronches"},
    "PT74": {"lat": 38.9435, "lng": -8.1643, "place": "Mora"},
    "PT75": {"lat": 38.3733, "lng": -8.5144, "place": "Alcácer do Sal"},
    "PT76": {"lat": 37.8776, "lng": -8.1652, "place": "Aljustrel"},
    "PT77": {"lat": 37.5128, "lng": -8.0601, "place": "Almodôvar"},
    "PT78": {"lat": 38.0151, "lng": -7.8632, "place": "Beja"},
    "PT79": {"lat": 38.2561, "lng": -7.9916, "place": "Alvito"},
    "PT80": {"lat": 37.0194, "lng": -7.9322, "place": "Faro"},
    "PT81": {"lat": 37.1377, "lng": -8.0197, "place": "Loulé"},
    "PT82": {"lat": 37.0882, "lng": -8.2503, "place": "Tavagueira"},
    "PT83": {"lat": 37.1939, "lng": -8.4702, "place": "Almarjão"},
    "PT84": {"lat": 37.1353, "lng": -8.4532, "place": "Lagoa"},
    "PT85": {"lat": 37.3337, "lng": -8.4905, "place": "Alferce"},
    "PT86": {"lat": 37.3192, "lng": -8.8033, "place": "Aljezur"},
    "PT87": {"lat": 37.0286, "lng": -7.8411, "place": "Olhão"},
    "PT88": {"lat": 37.1273, "lng": -7.6486, "place": "Tavira"},
    "PT89": {"lat": 37.4966, "lng": -7.5417, "place": "Afonso Vicente"},
    "PT90": {"lat": 32.7203, "lng": -16.9699, "place": "Curral das Freiras"},
    "PT91": {"lat": 32.6667, "lng": -16.8167, "place": "Gaula"},
    "PT92": {"lat": 32.7382, "lng": -16.7818, "place": "Machico"},
    "PT93": {"lat": 32.715, "lng": -17.1497, "place": "Arco da Calheta"},
    "PT94": {"lat": 33.0602, "lng": -16.3341, "place": "Porto Santo"},
    "PT95": {"lat": 36.9461, "lng": -25.1469, "place": "Vila do Porto"},
    "PT96": {"lat": 37.85, "lng": -25.2667, "place": "Achada"},
    "PT97": {"lat": 38.65, "lng": -27.2167, "place": "Angra do Heroísmo"},
    "PT98": {"lat": 38.6501, "lng": -28.1302, "place": "Santa Cruz da Graciosa"},
    "PT99": {"lat": 38.4038, "lng": -28.0823, "place": "Boca das Canadas"},
    "SE10": {"lat": 59.3326, "lng": 18.0649, "place": "Stockholm"},
    "SE11": {"lat": 59.3326, "lng": 18.0649, "place": "Stockholm"},
    "SE12": {"lat": 59.2755, "lng": 17.902, "place": "Skärholmen"},
    "SE13": {"lat": 59.4675, "lng": 18.7494, "place": "Ingmarsö"},
    "SE14": {"lat": 59.237, "lng": 17.9819, "place": "Huddinge"},
    "SE15": {"lat": 59.1833, "lng": 17.4333, "place": "Nykvarn"},
    "SE16": {"lat": 59.35, "lng": 17.9167, "place": "Bromma"},
    "SE17": {"lat": 59.3501, "lng": 17.9658, "place": "Järfälla"},
    "SE18": {"lat": 59.5344, "lng": 18.0776, "place": "Vallentuna"},
    "SE19": {"lat": 59.5833, "lng": 17.8833, "place": "Rosersberg"},
    "SE20": {"lat": 55.6059, "lng": 13.0007, "place": "Malmö"},
    "SE21": {"lat": 55.6059, "lng": 13.0007, "place": "Malmö"},
    "SE22": {"lat": 55.7028, "lng": 13.1927, "place": "Lund"},
    "SE23": {"lat": 55.6325, "lng": 13.0714, "place": "Arlöv"},
    "SE24": {"lat": 55.6428, "lng": 13.2064, "place": "Staffanstorp"},
    "SE25": {"lat": 56.0467, "lng": 12.6944, "place": "Helsingborg"},
    "SE26": {"lat": 56.0, "lng": 13.2833, "place": "Röstånga"},
    "SE27": {"lat": 55.4784, "lng": 13.5019, "place": "Skurup"},
    "SE28": {"lat": 56.4614, "lng": 13.5964, "place": "Markaryd"},
    "SE29": {"lat": 56.2773, "lng": 14.534, "place": "Olofström"},
    "SE30": {"lat": 56.6745, "lng": 12.8568, "place": "Halmstad"},
    "SE31": {"lat": 56.95, "lng": 13.5167, "place": "Unnaryd"},
    "SE33": {"lat": 57.3167, "lng": 13.8667, "place": "Hillerstorp"},
    "SE34": {"lat": 57.0333, "lng": 14.5833, "place": "Torpsbruk"},
    "SE35": {"lat": 56.8777, "lng": 14.8091, "place": "Växjö"},
    "SE36": {"lat": 57.1701, "lng": 15.3443, "place": "Åseda"},
    "SE37": {"lat": 56.1167, "lng": 15.5667, "place": "Drottningskär"},
    "SE38": {"lat": 56.4125, "lng": 15.9984, "place": "Torsås"},
    "SE39": {"lat": 56.6616, "lng": 16.3616, "place": "Kalmar"},
    "SE40": {"lat": 57.7072, "lng": 11.9668, "place": "Göteborg"},
    "SE41": {"lat": 57.7072, "lng": 11.9668, "place": "Göteborg"},
    "SE42": {"lat": 57.5667, "lng": 11.9333, "place": "Billdal"},
    "SE43": {"lat": 57.05, "lng": 12.4, "place": "Tvååker"},
    "SE44": {"lat": 58.0705, "lng": 11.8181, "place": "Stenungsund"},
    "SE45": {"lat": 58.3559, "lng": 11.2241, "place": "Smögen"},
    "SE46": {"lat": 58.3322, "lng": 12.6812, "place": "Grästorp"},
    "SE47": {"lat": 57.6897, "lng": 11.6497, "place": "Öckerö"},
    "SE50": {"lat": 57.721, "lng": 12.9401, "place": "Borås"},
    "SE51": {"lat": 57.3167, "lng": 12.5667, "place": "Kungsäter"},
    "SE52": {"lat": 58.0774, "lng": 13.0266, "place": "Herrljunga"},
    "SE53": {"lat": 58.1667, "lng": 12.9833, "place": "Vedum"},
    "SE54": {"lat": 58.5372, "lng": 14.5047, "place": "Karlsborg"},
    "SE55": {"lat": 57.7815, "lng": 14.1562, "place": "Jönköping"},
    "SE56": {"lat": 57.9171, "lng": 13.8783, "place": "Mullsjö"},
    "SE57": {"lat": 57.8246, "lng": 15.2736, "place": "Österbymo"},
    "SE58": {"lat": 58.4167, "lng": 15.6167, "place": "Linköping"},
    "SE59": {"lat": 58.2295, "lng": 14.6529, "place": "Ödeshög"},
    "SE60": {"lat": 58.5942, "lng": 16.1826, "place": "Norrköping"},
    "SE61": {"lat": 58.75, "lng": 16.85, "place": "Enstaberga"},
    "SE62": {"lat": 57.05, "lng": 18.2667, "place": "Burgsvik"},
    "SE63": {"lat": 59.3666, "lng": 16.5077, "place": "Eskilstuna"},
    "SE64": {"lat": 59.0433, "lng": 15.8737, "place": "Vingåker"},
    "SE65": {"lat": 59.3793, "lng": 13.5036, "place": "Karlstad"},
    "SE66": {"lat": 58.9125, "lng": 11.9253, "place": "Ed"},
    "SE67": {"lat": 59.7167, "lng": 12.15, "place": "Koppom"},
    "SE68": {"lat": 60.4333, "lng": 13.2667, "place": "Stöllet"},
    "SE69": {"lat": 58.9863, "lng": 14.619, "place": "Laxå"},
    "SE70": {"lat": 59.2741, "lng": 15.2066, "place": "Örebro"},
    "SE71": {"lat": 59.1737, "lng": 14.8723, "place": "Fjugesta"},
    "SE72": {"lat": 59.6162, "lng": 16.5528, "place": "Västerås"},
    "SE73": {"lat": 59.8, "lng": 15.55, "place": "Riddarhyttan"},
    "SE74": {"lat": 59.5671, "lng": 17.5278, "place": "Bålsta"},
    "SE75": {"lat": 59.8585, "lng": 17.6454, "place": "Uppsala"},
    "SE76": {"lat": 59.6347, "lng": 18.6281, "place": "Bergshamra"},
    "SE77": {"lat": 60.0833, "lng": 14.9833, "place": "Grängesberg"},
    "SE78": {"lat": 60.5089, "lng": 14.2246, "place": "Vansbro"},
    "SE79": {"lat": 60.6167, "lng": 15.0, "place": "Djura"},
    "SE80": {"lat": 60.6745, "lng": 17.1417, "place": "Gävle"},
    "SE81": {"lat": 64.3167, "lng": 19.6333, "place": "Hällnäs"},
    "SE82": {"lat": 61.3468, "lng": 16.075, "place": "Alfta"},
    "SE83": {"lat": 64.2083, "lng": 15.6833, "place": "Norråker"},
    "SE84": {"lat": 62.4833, "lng": 16.0167, "place": "Ljungaverk"},
    "SE85": {"lat": 62.3913, "lng": 17.3063, "place": "Sundsvall"},
    "SE86": {"lat": 62.51, "lng": 17.3714, "place": "Sörberge"},
    "SE87": {"lat": 62.6667, "lng": 17.8333, "place": "Älandsbro"},
    "SE88": {"lat": 63.4333, "lng": 16.9, "place": "Näsåker"},
    "SE89": {"lat": 63.7, "lng": 18.8, "place": "Trehörningsjö"},
    "SE90": {"lat": 63.8284, "lng": 20.2597, "place": "Umeå"},
    "SE91": {"lat": 63.5685, "lng": 19.5024, "place": "Nordmaling"},
    "SE92": {"lat": 64.2017, "lng": 19.7195, "place": "Vindeln"},
    "SE93": {"lat": 64.9121, "lng": 19.4815, "place": "Norsjö"},
    "SE94": {"lat": 65.6762, "lng": 21.0016, "place": "Älvsbyn"},
    "SE95": {"lat": 66.3275, "lng": 22.8441, "place": "Överkalix"},
    "SE96": {"lat": 66.4304, "lng": 20.6243, "place": "Vuollerim"},
    "SE97": {"lat": 65.5842, "lng": 22.1546, "place": "Luleå"},
    "SE98": {"lat": 66.9593, "lng": 19.8207, "place": "Porjus"},
    "SK01": {"lat": 48.972, "lng": 18.3161, "place": "Košecké Podhradie"},
    "SK02": {"lat": 49.1336, "lng": 18.2995, "place": "Bezdedov - Vieska"},
    "SK03": {"lat": 49.0331, "lng": 19.564, "place": "Pavčina Lehota"},
    "SK04": {"lat": 48.7277, "lng": 20.0482, "place": "Muránska Lehota"},
    "SK05": {"lat": 48.7376, "lng": 20.1425, "place": "Muránska Zdychava"},
    "SK06": {"lat": 48.9282, "lng": 21.8467, "place": "Závadka"},
    "SK07": {"lat": 48.7925, "lng": 21.8736, "place": "Petrovce nad Laborcom"},
    "SK08": {"lat": 49.2756, "lng": 21.1908, "place": "Richvald"},
    "SK09": {"lat": 49.0424, "lng": 21.781, "place": "Košarovce"},
    "SK81": {"lat": 48.1504, "lng": 17.09, "place": "Bratislava-Staré Mesto"},
    "SK82": {"lat": 48.1555, "lng": 17.1564, "place": "Bratislava-Ružinov"},
    "SK83": {"lat": 48.2094, "lng": 17.179, "place": "Bratislava"},
    "SK84": {"lat": 48.1791, "lng": 17.0369, "place": "Bratislava"},
    "SK85": {"lat": 48.0427, "lng": 17.1722, "place": "Bratislava"},
    "SK90": {"lat": 48.2747, "lng": 17.0317, "place": "Stupava"},
    "SK91": {"lat": 48.4393, "lng": 17.7116, "place": "Trakovice"},
    "SK92": {"lat": 48.2381, "lng": 17.4286, "place": "Boldog"},
    "SK93": {"lat": 47.9045, "lng": 17.8857, "place": "Madérét"},
    "SK94": {"lat": 47.7636, "lng": 18.1226, "place": "Komárno"},
    "SK95": {"lat": 48.3328, "lng": 18.1283, "place": "Nitrianske Hrnčiarovce"},
    "SK96": {"lat": 48.4747, "lng": 18.9337, "place": "Banská Belá"},
    "SK97": {"lat": 48.7562, "lng": 19.0768, "place": "Riečka"},
    "SK98": {"lat": 48.5797, "lng": 19.6356, "place": "Látky"},
    "SK99": {"lat": 48.1969, "lng": 19.3978, "place": "Veľké Straciny"},
}


# ---------- Вспомогательные функции (перенесены из Colab-версии) ----------

def format_duration(seconds):
    days, rem = divmod(int(seconds or 0), 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days > 0:
        return f"{days}д {hours}ч {minutes}мин"
    return f"{hours}ч {minutes}мин"


def normalize(s):
    return str(s or "").lower().replace(" ", "").replace("-", "")


def find_unit_by_label(units, label_query):
    q = normalize(label_query)
    return [
        u for u in units
        if q in normalize(u.get("label", "")) or q in normalize(u.get("number", ""))
    ]


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def round_to_15min(dt: datetime) -> datetime:
    discard = timedelta(minutes=dt.minute % 15, seconds=dt.second, microseconds=dt.microsecond)
    dt -= discard
    if discard >= timedelta(minutes=7.5):
        dt += timedelta(minutes=15)
    return dt


def calc_eta(dist_km):
    duration_h = dist_km / 70
    now_utc = datetime.now(timezone.utc)
    eta_utc = now_utc + timedelta(hours=duration_h)
    eta_local = round_to_15min(eta_utc + timedelta(hours=WEST_EUROPE_OFFSET))
    return duration_h, eta_local


def fetch_units(api_key):
    resp = requests.get(MAPON_API_URL, params={"key": api_key}, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(data["error"].get("msg", "Mapon API error"))
    return data["data"]["units"]


def fetch_group_unit_ids(api_key, group_id):
    resp = requests.get(
        MAPON_GROUP_UNITS_URL, params={"key": api_key, "id": group_id}, timeout=20
    )
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(data["error"].get("msg", "Mapon API error"))
    return {u["id"] for u in data["data"]["units"]}


def resolve_target(target_str):
    """Определяет тип таргета (GPS / код региона / город) и возвращает (lat, lng)."""
    target_str = (target_str or "").strip()
    if not target_str:
        return None, None

    # 1. GPS: "lat, lng"
    if "," in target_str:
        parts = target_str.split(",")
        if len(parts) == 2:
            try:
                lat, lng = float(parts[0].strip()), float(parts[1].strip())
                return lat, lng
            except ValueError:
                pass

    # 2. Код региона (например NO01, SE25) — короткая буквенно-цифровая строка без пробелов
    key = target_str.upper().replace(" ", "")
    if key in REGION_CODES:
        return REGION_CODES[key]["lat"], REGION_CODES[key]["lng"]

    # 3. Город/адрес — геокодинг
    resp = requests.get(
        NOMINATIM_URL,
        params={"q": target_str, "format": "json", "limit": 1},
        headers={"User-Agent": "fleet-eta-tracker/1.0"},
        timeout=15,
    )
    resp.raise_for_status()
    results = resp.json()
    if not results:
        raise ValueError(f"Не удалось распознать таргет: {target_str}")
    return float(results[0]["lat"]), float(results[0]["lon"])


def resolve_place_label(target_str):
    """Возвращает (lat, lng, label) — то же, что resolve_target, плюс человекочитаемое
    название места (из REGION_CODES для кодов регионов, иначе сам ввод пользователя)."""
    key = (target_str or "").strip().upper().replace(" ", "")
    lat, lng = resolve_target(target_str)
    if lat is None:
        return None, None, None
    if key in REGION_CODES:
        label = f"{key} — {REGION_CODES[key]['place']}"
    else:
        label = target_str.strip()
    return lat, lng, label


def road_distance_km_google(lat1, lng1, lat2, lng2, api_key, waypoints=None):
    """waypoints — необязательный список [(lat, lng), ...] промежуточных точек,
    через которые маршрут должен пройти в заданном порядке."""
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    }
    body = {
        "origin": {"location": {"latLng": {"latitude": lat1, "longitude": lng1}}},
        "destination": {"location": {"latLng": {"latitude": lat2, "longitude": lng2}}},
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
    }
    if waypoints:
        body["intermediates"] = [
            {"location": {"latLng": {"latitude": wlat, "longitude": wlng}}}
            for wlat, wlng in waypoints
        ]
    resp = requests.post(ROUTES_API_URL, json=body, headers=headers, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    if "routes" not in data or not data["routes"]:
        raise RuntimeError(f"Routes API вернул пустой ответ: {data}")
    route = data["routes"][0]
    distance_km = route["distanceMeters"] / 1000
    polyline = route.get("polyline", {}).get("encodedPolyline")
    return distance_km, polyline


# ---------- Правила принудительных маршрутов (обход Швейцарии, паромы на Скандинавию) ----------
# Пока применяются только во вкладке From -> To (/api/route), где обе точки заданы
# кодами регионов — страна извлекается из первых двух букв кода. Для вкладки "Флот"
# (текущая позиция машины из Mapon) страна отправления неизвестна без обратного
# геокодинга, поэтому там правила пока не применяются.

INNSBRUCK = (47.2692, 11.4041)
PUTTGARDEN = (54.5008, 11.2158)
RODBY = (54.6559, 11.3600)
ROSTOCK_FERRY = (54.1766, 12.0894)   # Warnemünde, паромный терминал у Ростока
GEDSER = (54.5730, 11.9250)
HELSINGOR = (56.0360, 12.6136)
HELSINGBORG = (56.0465, 12.6945)

BENELUX_FR = {"BE", "NL", "LU", "FR"}
ES_PT = {"ES", "PT"}
SCANDI = {"NO", "SE"}


def get_region_country(code_str):
    """Возвращает код страны (первые 2 буквы), если строка — известный код региона."""
    key = (code_str or "").strip().upper().replace(" ", "")
    return key[:2] if key in REGION_CODES else None


def _ferry_pair_for_country(other_country, other_lat, other_lng):
    """Южная пара паромных портов (материк -> Дания) для страны other_country."""
    if other_country == "IT":
        return (ROSTOCK_FERRY, GEDSER)
    if other_country in ES_PT or other_country in BENELUX_FR:
        return (PUTTGARDEN, RODBY)
    if other_country == "DE":
        d_rostock = haversine_km(other_lat, other_lng, ROSTOCK_FERRY[0], ROSTOCK_FERRY[1])
        d_puttgarden = haversine_km(other_lat, other_lng, PUTTGARDEN[0], PUTTGARDEN[1])
        return (ROSTOCK_FERRY, GEDSER) if d_rostock < d_puttgarden else (PUTTGARDEN, RODBY)
    return None


def pick_waypoints(from_str, from_lat, from_lng, to_str, to_lat, to_lng):
    """Возвращает список [(lat,lng), ...] промежуточных точек по известным правилам,
    или None, если ни одно правило не подходит."""
    from_country = get_region_country(from_str)
    to_country = get_region_country(to_str)
    if not from_country or not to_country:
        return None

    # Италия <-> Германия: всегда через Австрию (Инсбрук)
    if {from_country, to_country} == {"IT", "DE"}:
        return [INNSBRUCK]

    # Паромы на/из Норвегии-Швеции
    if from_country in SCANDI and to_country not in SCANDI:
        pair = _ferry_pair_for_country(to_country, to_lat, to_lng)
        if pair:
            south_port, dk_port = pair
            # едем с севера на юг — сначала датская сторона паромов, потом материковая
            return [HELSINGBORG, HELSINGOR, dk_port, south_port]
    elif to_country in SCANDI and from_country not in SCANDI:
        pair = _ferry_pair_for_country(from_country, from_lat, from_lng)
        if pair:
            south_port, dk_port = pair
            # едем с юга на север
            return [south_port, dk_port, HELSINGOR, HELSINGBORG]

    return None


# ---------- Routes ----------

@app.route("/")
def index():
    return render_template("index.html", google_maps_js_key=GOOGLE_MAPS_JS_KEY, app_version=APP_VERSION)


@app.route("/api/units")
def api_units():
    """Список машин из группы HEAD TRUCK — для дропдауна на фронтенде."""
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен на сервере"}), 500
    try:
        all_units = fetch_units(MAPON_API_KEY)
        group_ids = fetch_group_unit_ids(MAPON_API_KEY, HEAD_TRUCK_GROUP_ID)
        result = [
            {"unit_id": u["unit_id"], "number": u.get("number") or u.get("label")}
            for u in all_units
            if u["unit_id"] in group_ids
        ]
        result.sort(key=lambda x: x["number"] or "")
        return jsonify({"units": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/calc", methods=["POST"])
def api_calc():
    """
    body: {"unit": "OI1779", "target": "43.30726, -8.48246" | "Oslo" | "NO01" | ""}
    Возвращает статус машины и, если задан target, расстояние/ETA по дорогам.
    """
    if not MAPON_API_KEY:
        return jsonify({"error": "MAPON_API_KEY не настроен на сервере"}), 500

    payload = request.get_json(force=True, silent=True) or {}
    unit_query = payload.get("unit", "")
    target_str = payload.get("target", "")

    if not unit_query:
        return jsonify({"error": "Не указана машина"}), 400

    try:
        units = fetch_units(MAPON_API_KEY)
        matches = find_unit_by_label(units, unit_query)
        if not matches:
            return jsonify({"error": f"Машина '{unit_query}' не найдена"}), 404
        if len(matches) > 1:
            return jsonify({
                "error": "Найдено несколько машин, уточните запрос",
                "candidates": [u.get("number") for u in matches],
            }), 409

        unit = matches[0]
        state = unit.get("state", {})
        status_name = state.get("name")
        duration_sec = state.get("duration", 0)

        result = {
            "number": unit.get("number"),
            "status": status_name,
            "status_ru": STATUS_RU.get(status_name, status_name),
            "duration_str": format_duration(duration_sec),
            "speed": unit.get("speed"),
            "last_update": unit.get("last_update"),
            "unit_lat": unit.get("lat"),
            "unit_lng": unit.get("lng"),
            "dist_km": None,
            "eta_local": None,
        }

        target_lat, target_lng = resolve_target(target_str)
        if target_lat is not None and not GOOGLE_API_KEY:
            return jsonify({"error": "GOOGLE_API_KEY не настроен на сервере"}), 500

        if target_lat is not None:
            cur_lat, cur_lng = unit["lat"], unit["lng"]
            dist_km, polyline = road_distance_km_google(cur_lat, cur_lng, target_lat, target_lng, GOOGLE_API_KEY)
            _, eta_local = calc_eta(dist_km)
            result["dist_km"] = round(dist_km, 1)
            result["eta_local"] = eta_local.strftime("%d/%m %H:%M")
            result["target_lat"] = target_lat
            result["target_lng"] = target_lng
            result["route_polyline"] = polyline

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/route", methods=["POST"])
def api_route():
    """
    body: {"from": "ES30", "to": "SE25"} (каждое поле — GPS / город / код региона)
    Если задано только одно из полей — просто показываем эту точку (без
    расстояния/маршрута, потому что считать не от чего).
    """
    if not GOOGLE_API_KEY:
        return jsonify({"error": "GOOGLE_API_KEY не настроен на сервере"}), 500

    payload = request.get_json(force=True, silent=True) or {}
    from_str = payload.get("from", "")
    to_str = payload.get("to", "")

    if not from_str and not to_str:
        return jsonify({"error": "Укажите хотя бы одно поле — From или To"}), 400

    try:
        from_lat = from_lng = from_label = None
        to_lat = to_lng = to_label = None

        if from_str:
            from_lat, from_lng, from_label = resolve_place_label(from_str)
            if from_lat is None:
                return jsonify({"error": f"Не удалось распознать From: {from_str}"}), 400

        if to_str:
            to_lat, to_lng, to_label = resolve_place_label(to_str)
            if to_lat is None:
                return jsonify({"error": f"Не удалось распознать To: {to_str}"}), 400

        result = {
            "from_label": from_label,
            "to_label": to_label,
            "from_lat": from_lat,
            "from_lng": from_lng,
            "to_lat": to_lat,
            "to_lng": to_lng,
            "dist_km": None,
            "duration_h": None,
            "route_polyline": None,
        }

        if from_str and to_str:
            waypoints = pick_waypoints(from_str, from_lat, from_lng, to_str, to_lat, to_lng)
            dist_km, polyline = road_distance_km_google(
                from_lat, from_lng, to_lat, to_lng, GOOGLE_API_KEY, waypoints=waypoints
            )
            duration_h = dist_km / 70  # тот же ориентир скорости, что и в остальном приложении
            result["dist_km"] = round(dist_km, 1)
            result["duration_h"] = round(duration_h, 1)
            result["route_polyline"] = polyline
            result["waypoints_applied"] = bool(waypoints)

        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 502


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
