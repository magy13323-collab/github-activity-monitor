# GitHub Activity Monitor

GitHub Activity Monitor — учебный проект для анализа публичных репозиториев пользователя GitHub через публичный REST API.

Реализовано:
- Задача 1: веб-утилита (HTML/CSS/JavaScript).
- Задача 2: Python CLI + Docker для получения и сохранения статистики по репозиториям.
- Задача 3: Google Apps Script для выгрузки репозиториев в Google Таблицу.

## Структура проекта

- `web/` — веб-утилита
- `python-api/` — Python CLI и Docker
- `apps-script/` — `Code.gs` и инструкция для Google Таблицы
- `docs/` — документы по сдаче

## Как запустить web-часть локально

1. Откройте терминал в корне проекта.
2. Запустите сервер:

```bash
python -m http.server 8000
```

3. Откройте в браузере:

```text
http://localhost:8000/web/
```

Веб-демо публикуется через GitHub Pages из папки `web/`.

Web demo: [добавить ссылку после первого деплоя GitHub Pages]

## Задача 2. Python + Docker

Скрипт `python-api/main.py`:
- получает публичные репозитории пользователя из GitHub API;
- сортирует (`stars`, `forks`, `updated_at`) и ограничивает выдачу (`--limit`);
- считает summary;
- выводит результат в консоль;
- сохраняет результат в JSON.

### Локальный запуск (Windows PowerShell)

```powershell
cd python-api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py --username octocat --sort stars --limit 5
```

### Локальный запуск (macOS/Linux)

```bash
cd python-api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py --username octocat --sort stars --limit 5
```

### Сохранение результата в файл

```bash
python main.py --username octocat --sort updated_at --limit 10 --output output/octocat_repos.json
```

### Docker build/run

```bash
cd python-api
docker build -t github-activity-monitor .
docker run --rm github-activity-monitor --username octocat --sort stars --limit 5
```

### Docker run с сохранением файла (Windows PowerShell)

```powershell
docker run --rm -v ${PWD}/output:/app/output github-activity-monitor --username octocat --sort stars --limit 5 --output output/docker_result.json
```

### Пример консольного вывода

```text
GitHub Activity Monitor
============================================================
Пользователь: octocat
Всего публичных репозиториев: <число>
Суммарно stars: <число>
Суммарно forks: <число>
Сортировка: stars
Лимит в выдаче: 5
```

Примечание: значения stars/forks и количество репозиториев могут отличаться, так как данные берутся из live GitHub API.

### Формат JSON-результата

JSON содержит два верхнеуровневых ключа:
- `summary` — агрегированная статистика (`username`, `total_repositories`, `total_stars`, `total_forks`, `top_languages`, `sorted_by`, `limit`);
- `repositories` — список репозиториев с полями `name`, `description`, `language`, `stars`, `forks`, `updated_at` (ISO-строка), `url`.

Пример сохраненного результата: `python-api/output/example_output.json`.

## Задача 3. Apps Script + Google Таблица

Google Apps Script получает username из `B1` листа `Repositories`, запрашивает публичные репозитории через GitHub API и записывает:

- таблицу репозиториев (`A7:G`);
- статус выполнения (`B3`);
- время обновления (`B4`);
- summary-блок (`I1:J5`).

Код скрипта: `apps-script/Code.gs`.

Доступы Apps Script ограничены текущей таблицей через `@OnlyCurrentDoc` и настройки scopes в `apps-script/appsscript.json`.

Google Таблица: https://docs.google.com/spreadsheets/d/10gjX-4RTXRMi-qVaFnbrKK5YgWwECDPSDwwkTVpa0cM/edit?hl=ru&gid=0#gid=0
