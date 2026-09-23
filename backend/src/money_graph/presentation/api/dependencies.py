from dataclasses import dataclass

from fastapi import Request

from money_graph.application.use_cases.ask_question import AskQuestion
from money_graph.application.use_cases.get_analysis import GetAnalysis
from money_graph.application.use_cases.get_export import GetExport
from money_graph.application.use_cases.get_node import GetNode
from money_graph.application.use_cases.publish_analysis import PublishAnalysis


@dataclass(frozen=True)
class ApiServices:
    publish: PublishAnalysis
    analysis: GetAnalysis
    node: GetNode
    export: GetExport
    ask: AskQuestion


def services(request: Request) -> ApiServices:
    return request.app.state.services
