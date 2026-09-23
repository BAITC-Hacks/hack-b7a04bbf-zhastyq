from pathlib import Path

from money_graph.application.use_cases import AnalysisService
from money_graph.infrastructure.graph import NetworkxAnalyzer
from money_graph.infrastructure.llm import HttpLanguageModel
from money_graph.infrastructure.publisher import FilePublisher
from money_graph.infrastructure.reader import FileDatasetReader


def make_service(output_dir: Path) -> tuple[AnalysisService, FilePublisher]:
    publisher = FilePublisher(output_dir)
    service = AnalysisService(FileDatasetReader(), NetworkxAnalyzer(), publisher,
                              HttpLanguageModel.from_environment())
    return service, publisher
