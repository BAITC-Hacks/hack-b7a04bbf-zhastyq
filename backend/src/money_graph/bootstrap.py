from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from money_graph.application.interfaces.language_model import LanguageModel
from money_graph.application.use_cases.analyze_dataset import AnalyzeDataset
from money_graph.application.use_cases.ask_question import AskQuestion
from money_graph.application.use_cases.validate_dataset import ValidateDataset
from money_graph.config import AIConfig
from money_graph.infrastructure.exporters.csv_analysis_exporter import CsvAnalysisExporter
from money_graph.infrastructure.graph.networkx_calculator import NetworkxCalculator
from money_graph.infrastructure.readers.parquet_dataset_reader import ParquetDatasetReader
from money_graph.presentation.cli.main import run


def main() -> int:
    reader = ParquetDatasetReader()
    return run(
        ValidateDataset(reader),
        AnalyzeDataset(reader, NetworkxCalculator(), CsvAnalysisExporter()),
    )


if TYPE_CHECKING:
    from fastapi import FastAPI


def build_api(
    storage_root: Path,
    cors_origins: tuple[str, ...] = (),
    max_file_bytes: int = 25 * 1024 * 1024,
    language_model: LanguageModel | None = None,
) -> FastAPI:
    from money_graph.application.use_cases.get_analysis import GetAnalysis
    from money_graph.application.use_cases.get_export import GetExport
    from money_graph.application.use_cases.get_node import GetNode
    from money_graph.application.use_cases.publish_analysis import PublishAnalysis
    from money_graph.infrastructure.repositories.file_analysis_storage import FileAnalysisStorage
    from money_graph.infrastructure.repositories.memory_analysis_store import MemoryAnalysisStore
    from money_graph.presentation.api.app import create_app
    from money_graph.presentation.api.dependencies import ApiServices

    store = MemoryAnalysisStore()
    files = FileAnalysisStorage(storage_root, max_file_bytes)
    analyzer = AnalyzeDataset(ParquetDatasetReader(), NetworkxCalculator(), CsvAnalysisExporter())
    query = GetAnalysis(store)
    return create_app(
        ApiServices(
            PublishAnalysis(analyzer, store, files),
            query,
            GetNode(query),
            GetExport(query, files),
            AskQuestion(query, language_model),
        ),
        cors_origins,
        max_file_bytes,
    )


def create_api_app() -> FastAPI:
    import os

    origins = tuple(
        origin.strip() for origin in os.getenv("CORS_ORIGINS", "").split(",") if origin.strip()
    )
    from money_graph.infrastructure.ai.openai_language_model import OpenAILanguageModel

    config = AIConfig.from_environment()
    model = OpenAILanguageModel(config) if config.configured else None
    return build_api(
        Path(os.getenv("ANALYSIS_STORAGE_DIR", "out/api")), origins, language_model=model
    )
