from money_graph.application.use_cases.analyze_dataset import AnalyzeDataset
from money_graph.application.use_cases.validate_dataset import ValidateDataset
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
