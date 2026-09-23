# Архитектура backend

```mermaid
flowchart LR
    A[CSV / Parquet<br>nodes, edges, transactions] --> B[FileDatasetReader<br>валидация схемы и агрегатов]
    B --> C[AnalysisService<br>единый сценарий CLI и API]
    C --> D[NetworkxAnalyzer<br>метрики, роли, Louvain, аналитика]
    D --> E[FilePublisher<br>версионные CSV и JSON]
    E --> F[GET analysis / nodes / exports]
    F --> G[Аналитик и интерфейс команды]
    G --> H[POST ask с analysis_id]
    H --> C
    C --> I[Выбор фактов из графа]
    I --> J[LLM порт]
    J --> K[OpenAI Responses или NVIDIA Chat Completions]
```

`domain` содержит модели, приоритет и правила ролей без файловой системы или графовых библиотек. `application` задаёт порты и последовательность: чтение → расчёт → публикация → смена активного анализа. `infrastructure` реализует порты. `presentation` преобразует запросы и ошибки. `composition.py` связывает адаптеры.

Граф направленный для потоков и признаков. Louvain использует ненаправленную проекцию только для группировки. Публикация пишет полную версию в отдельную папку и атомарно меняет указатель `current`; ошибка до этого шага оставляет прошлый анализ действующим. Запрос к ИИ получает только выбранные факты и не может изменить расчёт.
