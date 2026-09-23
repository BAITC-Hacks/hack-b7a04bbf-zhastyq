from money_graph.domain.models.analysis import NodeFeatures
from money_graph.domain.models.observation import ObservationAdvice
from money_graph.domain.services.observation_policy import (
    MIN_OBSERVED_AMOUNT_KZT,
    OBSERVATION_PERIOD,
    is_isolated,
    is_observation_boundary,
)


def assess_observation(features: NodeFeatures) -> tuple[ObservationAdvice, ...]:
    advice: list[ObservationAdvice] = []
    if is_observation_boundary(features):
        advice.append(
            ObservationAdvice(
                "DEPTH_BOUNDARY",
                "Исходящие переводы за границей обхода неизвестны; отсутствие связей "
                "не доказывает, что деньги остались на счёте",
                f"depth={features.depth}; out_deg={features.out_degree}",
                "Запросить исходящие переводы этого узла за тот же период "
                "за пределами текущего обхода",
                "Проверить, продолжается ли движение средств за границей наблюдения",
            )
        )
    if features.is_seed:
        advice.append(
            ObservationAdvice(
                "SEED_INCOMING_INCOMPLETE",
                "Входящие seed представлены не полностью; out/in нельзя трактовать "
                "как достоверный баланс или удержание средств",
                f"is_seed=true; in_deg={features.in_degree}; in_kzt={features.incoming_kzt}",
                "Запросить полную историю входящих переводов узла за период выборки",
                "Проверить источники поступлений seed, которые могли не попасть в обход",
            )
        )
    if is_isolated(features):
        advice.append(
            ObservationAdvice(
                "ISOLATED_NODE",
                "Узел не имеет наблюдаемых связей; это не доказывает отсутствие деятельности",
                f"in_deg={features.in_degree}; out_deg={features.out_degree}",
                "Проверить полноту выгрузки для этого gid и запросить сведения об операциях, "
                "которые могли быть исключены условиями сбора",
                "Выяснить, связано ли отсутствие связей с выгрузкой или условиями сбора",
            )
        )
    excess_outflow = features.outgoing_kzt > features.incoming_kzt
    if excess_outflow:
        advice.append(
            ObservationAdvice(
                "OUTFLOW_EXCEEDS_INFLOW",
                "Исходящий оборот больше наблюдаемого входящего. Причиной может быть остаток "
                "на начало периода или отсутствующие поступления; это не доказанная аномалия",
                f"out_kzt={features.outgoing_kzt}; in_kzt={features.incoming_kzt}",
                "Запросить остатки на начало и конец периода и полную выписку операций узла",
                "Сопоставить потоки с остатками и полной историей, "
                "проверить возможные источники покрытия исходящего оборота",
            )
        )
    advice.extend(
        (
            ObservationAdvice(
                "INTRABANK_ONLY",
                "Выборка охватывает внутрибанковские переводы; межбанковские операции "
                "могли остаться вне наблюдения, их наличие не установлено",
                "Условие выборки: только внутрибанковские переводы",
                "Запросить сведения о межбанковских переводах узла за тот же период",
                "Проверить возможные поступления и направления средств вне наблюдаемого банка",
            ),
            ObservationAdvice(
                "AMOUNT_THRESHOLD",
                f"Переводы ниже {MIN_OBSERVED_AMOUNT_KZT} KZT могли остаться вне выборки; "
                "их наличие не установлено",
                f"Условие выборки: sum_kzt >= {MIN_OBSERVED_AMOUNT_KZT}",
                f"Запросить операции узла ниже {MIN_OBSERVED_AMOUNT_KZT} KZT за тот же период",
                "Проверить связи и обороты, которые могли быть исключены порогом суммы",
            ),
            ObservationAdvice(
                "LIMITED_PERIOD",
                "Наблюдаемый период ограничен; операции до и после него неизвестны",
                f"Период выборки: {OBSERVATION_PERIOD}",
                "Запросить выписки узла за согласованные периоды до и после периода выборки",
                "Проверить, применима ли гипотеза о роли узла за пределами текущего периода",
            ),
        )
    )
    if not excess_outflow:
        advice.append(
            ObservationAdvice(
                "BALANCES_UNAVAILABLE",
                "Полные остатки неизвестны; наблюдаемые переводы не определяют баланс счёта",
                "В исходном наборе nodes/edges/transactions нет данных об остатках",
                "Запросить остатки на начало и конец периода для счетов узла",
                "Проверить гипотезу об удержании средств с учётом остатков, а не только переводов",
            )
        )
    return tuple(advice)
