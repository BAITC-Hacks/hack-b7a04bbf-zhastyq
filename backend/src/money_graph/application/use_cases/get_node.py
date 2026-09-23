from money_graph.application.dto.active_analysis import NodeCard
from money_graph.application.exceptions import ApiError
from money_graph.application.use_cases.get_analysis import GetAnalysis
from money_graph.domain.services.observation_assessment import assess_observation
from money_graph.domain.services.observation_policy import observation_limitations


class GetNode:
    def __init__(self, analysis: GetAnalysis) -> None:
        self._analysis = analysis

    def execute(self, gid: int) -> NodeCard:
        snapshot = self._analysis.execute()
        node = next((node for node in snapshot.nodes if node.analysis.features.gid == gid), None)
        if node is None:
            raise ApiError("GID_NOT_FOUND", "Узел не найден", {"gid": str(gid)})
        return NodeCard(
            snapshot.analysis_id,
            node,
            tuple(edge for edge in snapshot.edges if edge.dst == gid),
            tuple(edge for edge in snapshot.edges if edge.src == gid),
            observation_limitations(node.analysis.features),
            assess_observation(node.analysis.features),
        )
