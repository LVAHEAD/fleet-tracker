# Деплой на Cloud Run

## 1. Установите gcloud (если ещё нет)
https://cloud.google.com/sdk/docs/install — или используйте Cloud Shell
прямо в браузере (console.cloud.google.com → иконка терминала справа
вверху), там gcloud уже есть.

## 2. Выберите проект
```bash
gcloud config set project my-n8n-bot-496614
```

## 3. Распакуйте fleet-tracker.zip и перейдите в папку
```bash
unzip fleet-tracker.zip
cd fleet-tracker
```

## 4. Разверните одной командой
```bash
gcloud run deploy fleet-eta-tracker \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars MAPON_API_KEY=ваш_mapon_ключ,GOOGLE_API_KEY=ваш_google_ключ,HEAD_TRUCK_GROUP_ID=62269
```

Первый деплой займёт пару минут (Cloud Run сам соберёт контейнер из
requirements.txt + Procfile через buildpack — Dockerfile не нужен).
В конце в терминале появится ссылка на сервис — по ней и открывается
таблица.

## Обновление после правок кода
Та же команда `gcloud run deploy ...` — Cloud Run пересоберёт и
выкатит новую версию по тому же URL.

## Про ключи (важно)
Через `--set-env-vars` ключи попадают в переменные окружения — рабочий
вариант для старта, но их видно всем, кто может смотреть на настройки
сервиса в консоли. Позже стоит перенести на **Secret Manager**:

```bash
echo -n "ваш_mapon_ключ" | gcloud secrets create mapon-api-key --data-file=-
echo -n "ваш_google_ключ" | gcloud secrets create google-api-key --data-file=-

gcloud run deploy fleet-eta-tracker \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-secrets MAPON_API_KEY=mapon-api-key:latest,GOOGLE_API_KEY=google-api-key:latest \
  --set-env-vars HEAD_TRUCK_GROUP_ID=62269
```

## Ограничения текущей версии (v1.0)
- Карта пока не реализована (отдельная задача на потом)
- Коды регионов (NO01, SE25 и т.п.) пока не работают — таргет принимает
  только GPS-координаты и названия городов; справочник кодов добавим,
  когда пришлёте таблицу
- Состояние таблицы хранится в localStorage браузера — то есть
  привязано к конкретному браузеру/устройству, не общее между
  несколькими людьми
