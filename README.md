# Quest — сервис навигации с игровыми точками интереса

Персональный квест-подарок: игрок перемещается по реальной местности с GPS, находит точки интереса на карте, проходит мини-игры, собирает предметы и попадает в таблицу лидеров. Спецификация: [game_service.md](game_service.md), контракт мини-игр: [minigame_contract.md](minigame_contract.md).

## Стек

- **Сервер**: Node.js + TypeScript, Fastify, better-sqlite3 (WAL), ≤300 МБ RAM
- **Игрок** (`/`): React + Vite, MapLibre GL JS (векторный 3D-режим + растровый дальний), PWA-оффлайн
- **AdminPanel** (`/admin`): React + Vite, генерация тайлов в браузере (Overpass → MVT/WebP)
- **Мини-игры**: изолированные vanilla-TS модули (`/minigames/*`), Vite library-mode

## Структура

```
server/                 Fastify API, SQLite, статика
web/player/             приложение игрока (мета)
web/admin/              административная панель
packages/tile-pipeline/ браузерная генерация тайлов (MVT + растр WebP)
packages/shared/        (зарезервировано)
minigames/              sliding-puzzle, find-object, runner, arkanoid
docker/                 Dockerfile, docker-compose (app + cloudflared)
data/                   runtime-данные (gitignored): app.sqlite, tiles/, assets/, osm-cache/
scripts/                sync-minigames, e2e-mvp
```

## Запуск (разработка)

```bash
npm install
npm run build            # собирает всё + синкает мини-игры в server/static
npm run dev:server       # Fastify на :8080 (отдаёт собранные player и admin)
# либо с HMR:
npm run dev:player       # :5173, проксирует /api на :8080
npm run dev:admin        # :5174
```

Тесты: `npm run test`. Программный e2e: `npx tsx scripts/e2e-mvp.ts` (сервер должен слушать :8123).

## Деплой (Docker + Cloudflare Tunnel)

1. Зарегистрируйте домен на Cloudflare, создайте Tunnel (Zero Trust → Networks → Tunnels), скопируйте токен.
2. `cp docker/.env.example docker/.env` и заполните: `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `COOKIE_SECRET` (длинная случайная строка), `CLOUDFLARE_TUNNEL_TOKEN`.
3. В настройках туннеля направьте `game.ваш-домен.com` → `http://app:8080`.
4. `docker compose -f docker/docker-compose.yml --env-file docker/.env up -d --build`

HTTPS обязателен для GPS — сертификат выдаёт Cloudflare автоматически. Порты на роутере открывать не нужно. Данные живут в `./data` (бэкап = копия каталога).

## Первичная настройка (AdminPanel)

1. `https://game.домен.com/admin` → вход.
2. **Карта**: выделите прямоугольный участок, сохраните, сгенерируйте векторные (z14–17) и растровые (z11–13) тайлы. Генерация идёт в браузере — используйте **Chrome/Edge** (WebP-кодирование недоступно в Safari). Прервалось — кнопка «Продолжить» в истории джобов.
3. **Ассеты**: загрузите изображения/звуки, назначьте звук нажатия кнопок.
4. **Точки интереса**: расставьте POI кликом, назначьте игры, блокировки, награды, радиус триггера.
5. **Мини-игры**: настройте параметры каждой игры (формы генерируются по schema.json), тестовый запуск — кнопкой ▶.
6. **Дебаг**: включите дебаг-режим для проверки без GPS (виртуальный джойстик у всех пользователей); после выключения игроку предложат удалить тестовые результаты, либо удалите их в разделе «Лидерборд».
7. **Лидерборд**: заполните фиктивных участников.

## Мини-игры

Каждая игра — каталог `minigames/<id>/` с `src/index.ts` (экспортирует `init(container, config, callbacks)` → `{destroy()}`), `schema.json` (форма в AdminPanel генерируется автоматически) и чистым движком `src/engine.ts` с vitest-тестами. Сборка `npm run build` кладёт dist в `server/static/minigames/<id>/`. Полный контракт: [minigame_contract.md](minigame_contract.md).

## Заметки по производительности

- Тайлы и ассеты отдаются со статическими кэш-заголовками (`immutable, max-age=1y` для тайлов).
- Player-приложение кэширует тайлы/ассеты/мини-игры через Service Worker (CacheFirst) — игра продолжается оффлайн; admin не кэшируется.
- Контейнер в простое потребляет ~50 МБ RAM (лимит 400 МБ в compose, требование ≤300 МБ).
