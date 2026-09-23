import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from money_graph.application.exceptions import AnalysisExportError, DatasetReadError
from money_graph.application.use_cases.analyze_dataset import AnalyzeDataset
from money_graph.application.use_cases.validate_dataset import ValidateDataset
from money_graph.domain.services.dataset_validator import DatasetValidationError


def run(
    use_case: ValidateDataset,
    analysis: AnalyzeDataset,
    argv: Sequence[str] | None = None,
) -> int:
    parser = argparse.ArgumentParser(prog="money-graph")
    commands = parser.add_subparsers(dest="command", required=True)
    validate = commands.add_parser("validate", help="Проверить три Parquet-файла")
    validate.add_argument("--data-dir", type=Path, required=True)
    analyze = commands.add_parser("analyze", help="Рассчитать роли, кластеры и приоритеты")
    analyze.add_argument("--data-dir", type=Path, required=True)
    analyze.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "analyze":
            summary = analysis.execute(args.data_dir, args.output_dir)
            print("Статус: OK")
            print(f"Узлов: {len(summary.result.nodes)}")
            print(f"Транзакций: {summary.n_transactions}")
            print(f"Кластеров: {len(summary.result.clusters)}")
            print(f"В топе: {len(summary.result.top_nodes)}")
            print(f"CSV: {args.output_dir}")
            print(f"Длительность: {summary.elapsed_seconds:.6f} с")
            return 0
        result = use_case.execute(args.data_dir)
    except (DatasetReadError, DatasetValidationError, AnalysisExportError) as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        return 1
    print("Статус: OK")
    print(f"Узлов: {result.n_nodes}")
    print(f"Рёбер: {result.n_edges}")
    print(f"Транзакций: {result.n_transactions}")
    print(f"Seed: {result.n_seed}")
    return 0
