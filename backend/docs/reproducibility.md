# Проверка воспроизводимости backend

Проверка документации для жюри, 23.09.2026. Код продукта не изменяется. Исходный backend: commit `03c117f`, feature-ветка `refactor/clean-architecture`.

## Область проверки

Временное Python-окружение создаётся внутри `backend/.tmp/`, исключённого из Git. Существующее `.venv`, исходные Parquet и чужие файлы сохраняются. Это проверка чистой установки Python-зависимостей на существующей машине, не тест нового образа ОС и не повторный git clone.

Frontend в checkout отсутствует; сборка и браузер не проверяются. Найдены и прочитаны оригинальный DOCX «HackAlem AI: Граф денег — восстановление финансовой структуры организованной группы по транзакционной сети» и README датасета из локальных материалов организаторов. Матрица в корневом README сверена с разделами 7–10 ТЗ. Прежние инструкции AGENTS и старый backup не используются как доказательство реализованных функций.

## Команды проверки

Команды ниже выполняются из backend. Окружение передаётся явным путём; активация не нужна:

```bash
mkdir -p .tmp
MG_VENV=".tmp/jury-$(date +%Y%m%d-%H%M%S)-$$"
test ! -e "$MG_VENV" &&
python3 -m venv "$MG_VENV" &&
TMPDIR="$PWD/.tmp" "$MG_VENV/bin/python" -m pip install --no-cache-dir \
  -c docs/requirements-verified.txt -e '.[dev]'
"$MG_VENV/bin/python" -m pip check
"$MG_VENV/bin/money-graph" validate --data-dir data
"$MG_VENV/bin/money-graph" analyze --data-dir data --output-dir "$MG_VENV/out"
```

Отличие от быстрого запуска — временные пути окружения и output-dir, чтобы не перезаписывать существующие результаты команды.

```bash
"$MG_VENV/bin/python" - "$MG_VENV/out" <<'PY'
import csv
import sys
from pathlib import Path
output = Path(sys.argv[1])
expected = {'nodes_roles.csv': 2248, 'clusters.csv': 88, 'top_nodes.csv': 20}
for name, count in expected.items():
    with (output / name).open(encoding='utf-8', newline='') as stream:
        rows = list(csv.DictReader(stream))
    assert len(rows) == count, (name, len(rows))
    print(name, len(rows))
PY
TMPDIR="$PWD/.tmp" "$MG_VENV/bin/python" -m pytest -q -p no:cacheprovider
"$MG_VENV/bin/ruff" check --no-cache .
"$MG_VENV/bin/ruff" format --check --no-cache .
```

API в отдельном терминале (для MG_VENV укажите тот же созданный путь):

```bash
OPENAI_API_KEY= OPENAI_MODEL= \
ANALYSIS_STORAGE_DIR="$MG_VENV/api-out" \
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173 \
TMPDIR="$PWD/.tmp" "$MG_VENV/bin/uvicorn" money_graph.bootstrap:create_api_app \
  --factory --host 127.0.0.1 --port 8000 --workers 1
```

Во втором терминале проверяются health, Swagger и CORS:

```bash
curl --fail-with-body http://127.0.0.1:8000/api/health
curl --fail-with-body -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/docs
curl --fail-with-body -i -X OPTIONS http://127.0.0.1:8000/api/analyze \
  -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: POST'
```

Для проверки `--env-file` используется копия `.env.example` под временным каталогом, а не файл команды с секретами. Пустые ключ/модель дают ai_configured=false; fake-настройки и приоритет окружения дополнительно проверяются автоматическим `tests/integration/test_env_file.py`. Ни тесты, ни проверка health не вызывают провайдера.

```bash
cp .env.example "$MG_VENV/launch.env"
# После остановки предыдущего временного сервера:
ANALYSIS_STORAGE_DIR="$MG_VENV/api-out" \
TMPDIR="$PWD/.tmp" "$MG_VENV/bin/uvicorn" money_graph.bootstrap:create_api_app \
  --factory --env-file "$MG_VENV/launch.env" --host 127.0.0.1 --port 8000 --workers 1
```

Уже заданные переменные процесса имеют приоритет над .env. В приёмке процесса переменные OpenAI/CORS очищаются перед проверкой файла, чтобы подтвердить именно его чтение. В файл и вывод не попадают реальные ключи. По завершении останавливаются только запущенные для проверки процессы.

## Ранее выполненная AI-приёмка

23.09.2026 один реальный POST /api/ask к OpenAI `gpt-6-luna` завершился HTTP 200 за 8,04 с. Ответ о роли consolidator для `100000003684369100` сверён с анализом: 24 плательщика, 58 входящих операций, 3 848 436 KZT. Точные ссылки, неполные входящие seed, усечённые связи и отсутствие утверждений о виновности проверены. См. commit `7a6459d` и backend/README. Здесь этот платный запрос не повторяется.

## Фактический результат

Все перечисленные ниже проверки выполнены в новом окружении `.tmp/jury-20260923-170546-112768`, не в основном `.venv`.

| Проверка | Результат |
|---|---|
| ОС и Python | Debian 12 / WSL2 Linux x86_64, Python 3.10.17 |
| Ресурсы машины | 12 доступных логических CPU, 7,46 GiB RAM; это описание стенда, не минимальные требования |
| Инструменты | pip 23.0.1, Git 2.39.5, curl 7.88.1; uv для чистой установки не использовался |
| Изоляция | include-system-site-packages=false; путей основного backend/.venv в sys.path нет |
| Установка | `python3 -m venv`, затем `pip install --no-cache-dir -c docs/requirements-verified.txt -e '.[dev]'`: успешно |
| Зависимости | Все 28 версий constraints совпали с установленными; `pip check`: No broken requirements found |
| validate | Exit 0: 2248 узла, 3119 рёбер, 4840 транзакций, 81 seed |
| analyze | Exit 0; **6,234291 с**, включая чтение, валидацию, весь расчёт и три CSV; меньше 300 с |
| CSV | 2248 / 88 / 20 строк; точные схемы, все исходные gid без дублей, заполненность, диапазоны score, evidence ≤200, принадлежность и размеры кластеров, порядок top-20 проверены |
| pytest | **288 passed, 1 warning in 18.69s**; предупреждение Starlette об устаревании httpx в TestClient |
| Ruff | Lint: All checks passed; format --check: 77 files already formatted |
| Health без ключа | HTTP 200: status=ok, analysis_ready=false, ai_configured=false |
| Swagger и CORS | `/docs`: 200; preflight разрешает http://localhost:5173 |
| HTTP-загрузка | Через curl POST /api/analyze; затем GET /api/analysis: 2248 узлов, 3119 рёбер, 88 кластеров |
| Временные наблюдения | rapid_outflow=669, synchronized_inflow=66, activity_spike=159; узлов с находками=331 |
| Карточки демо | Точные строковые gid `100000003684369100`, `100000000018102100`, `100000000089154100`; HTTP 200 |
| HTTP-экспорт | top_nodes.csv скачан через curl, 20 строк |
| Явный env-file | Отдельный запуск с копией .env.example; health=200, AI=false, CORS взят из файла при очищенном окружении |
| Провайдер AI | 0 обращений в текущей проверке |
| Завершение | Оба временных Uvicorn-процесса остановлены, основное .venv не пересоздавалось |

Проверки CLI и pytest запускались независимо на том же стенде; это фактически измеренное время, не бенчмарк минимальной задержки. Временное окружение, локальные логи и результаты оставлены под игнорируемым `.tmp/` для проверки командой; в Git они не входят.

## Что подтверждено и что остаётся

Жюри может воспроизвести backend от установки зависимостей до трёх CSV и HTTP-карточек без AI-ключа, показать ограничения и временные наблюдения через Swagger. Команды загрузки .env подтверждены без использования реальных секретов. Все пути и версии относятся к текущей проверенной feature-ветке.

Не проверялись: повторное клонирование репозитория, новая установка ОС/Python, нативная Windows/macOS, другие версии Python, сборка frontend и интерфейс в браузере. Оригинальные документы ТЗ и README датасета прочитаны, но не публикуются в Git. Архив организаторов необходимо получить отдельно. Файлы backend/data побайтово сверены с data/nodes.parquet, data/edges.parquet и data/transactions.parquet внутри предоставленного ZIP: SHA-256 совпали для всех трёх. Дополнительно успешно проверена распаковка через `python -m zipfile -e` в каталог внутри временного окружения.

Ошибок продукта, требующих изменения кода, в этой проверке не выявлено. Исправлены только инструкции: убрана обязательность uv, добавлены venv/ensurepip, зафиксированы версии зависимостей, уточнены явный env-file, отдельные состояния CLI/API и отсутствие frontend. Для полноценного сайта нужны frontend-код, подтверждённые команды package.json и браузерная интеграционная проверка по актуальному контракту. Must-have 5 ТЗ закрыт частично: top-20 есть, подтверждённого экрана с графом и поиском нет. Дополнительные пункты 3–5 (маршруты/циклы, аномалии, устойчивость) не реализованы. CSV-вход также отсутствует, но исходный ТЗ требует вход Parquet. Эти доработки не входят в этап документации.
