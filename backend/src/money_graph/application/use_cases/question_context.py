from money_graph.application.dto.active_analysis import AnalysisSnapshot, NodeView
from money_graph.application.dto.question import ContextEdge, ContextNode, QuestionContext
from money_graph.application.exceptions import ApiError
from money_graph.domain.services.observation_policy import observation_limitations

MAX_CONTEXT_BYTES = 32 * 1024
MAX_NEIGHBORS = 5
MAX_EDGES = 10


def _node_context(node: NodeView, selected: bool, rank: int | None) -> ContextNode:
    analysis = node.analysis
    f = analysis.features
    return ContextNode(
        str(f.gid),
        selected,
        analysis.decision.role,
        analysis.decision.score,
        analysis.priority.score,
        analysis.decision.evidence,
        analysis.priority.why,
        f.in_degree,
        f.out_degree,
        str(f.incoming_kzt),
        str(f.outgoing_kzt),
        f.incoming_transactions,
        f.outgoing_transactions,
        f.seed_neighbors,
        f.depth,
        f.is_seed,
        rank,
    )


def build_question_context(snapshot: AnalysisSnapshot, gids: tuple[int, ...]) -> QuestionContext:
    by_gid = {node.analysis.features.gid: node for node in snapshot.nodes}
    chosen = set(gids)
    ranks = {node.features.gid: rank for rank, node in enumerate(snapshot.result.top_nodes, 1)}
    selected_nodes = tuple(_node_context(by_gid[gid], True, ranks.get(gid)) for gid in gids)
    nearby = sorted(
        (edge for edge in snapshot.edges if edge.src in chosen or edge.dst in chosen),
        key=lambda edge: (-edge.sum_kzt, edge.src, edge.dst),
    )
    largest_outgoing = [next((edge for edge in nearby if edge.src == gid), None) for gid in gids]
    candidates = [edge for edge in largest_outgoing if edge is not None] + nearby
    neighbors: set[int] = set()
    edges: list[ContextEdge] = []
    seen: set[tuple[int, int]] = set()
    for edge in candidates:
        if (edge.src, edge.dst) in seen:
            continue
        additional = {edge.src, edge.dst} - chosen - neighbors
        if len(neighbors | additional) > MAX_NEIGHBORS:
            continue
        neighbors.update(additional)
        seen.add((edge.src, edge.dst))
        edges.append(ContextEdge(str(edge.src), str(edge.dst), str(edge.sum_kzt), edge.n_tx))
        if len(edges) == MAX_EDGES:
            break
    optional_nodes = tuple(
        _node_context(by_gid[gid], False, ranks.get(gid)) for gid in sorted(neighbors)
    )

    def assemble() -> QuestionContext:
        nodes = selected_nodes + optional_nodes
        notes = tuple(
            dict.fromkeys(
                note
                for node in nodes
                for note in observation_limitations(by_gid[int(node.gid)].analysis.features)
            )
        )
        if len(edges) < len(nearby):
            notes += (
                f"Связи усечены: показано {len(edges)} из {len(nearby)} близких рёбер; "
                "это не полный список получателей или плательщиков",
            )
        notes += (
            "Проверка ссылок не гарантирует истинность всего свободного текста модели; "
            "сверяйте объяснение с фактами и карточками",
        )
        return QuestionContext(nodes, tuple(edges), len(nearby), notes)

    context = assemble()
    while len(context.to_json().encode("utf-8")) > MAX_CONTEXT_BYTES and optional_nodes:
        removed = optional_nodes[-1].gid
        optional_nodes = optional_nodes[:-1]
        edges = [edge for edge in edges if removed not in (edge.src, edge.dst)]
        context = assemble()
    if len(context.to_json().encode("utf-8")) > MAX_CONTEXT_BYTES:
        raise ApiError("INVALID_QUESTION", "Контекст слишком велик: выберите меньше узлов")
    return context


def reference_facts(node: ContextNode, edges: tuple[ContextEdge, ...]) -> tuple[str, ...]:
    facts = (
        f"Роль: {node.role}",
        f"Оценка роли: {node.role_score}",
        f"Входящих контрагентов: {node.in_degree}",
        f"Исходящих контрагентов: {node.out_degree}",
        f"Входящий оборот: {node.incoming_kzt} KZT",
        f"Исходящий оборот: {node.outgoing_kzt} KZT",
        f"Приоритет: {node.priority_score}",
        f"Место в top-20: {node.top_rank if node.top_rank is not None else 'не входит'}",
        f"Глубина: {node.depth}",
        f"Seed: {'да' if node.is_seed else 'нет'}",
    )
    return facts + tuple(
        f"Наблюдаемая связь {edge.src} → {edge.dst}: {edge.sum_kzt} KZT; операций: {edge.n_tx}"
        for edge in edges
        if node.gid in (edge.src, edge.dst)
    )
