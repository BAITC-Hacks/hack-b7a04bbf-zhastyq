import csv
import json
import os
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from money_graph.application.exceptions import AnalysisExportError
from money_graph.domain.models.analysis import AnalysisResult

NODES_COLUMNS = ("gid", "role", "role_score", "cluster_id", "priority_score", "evidence")
CLUSTERS_COLUMNS = ("cluster_id", "n_nodes", "n_seed", "sum_kzt_internal", "top_gids", "hypothesis")
TOP_COLUMNS = ("rank", "gid", "role", "priority_score", "why")
FILENAMES = ("nodes_roles.csv", "clusters.csv", "top_nodes.csv")


def _write_csvs(result: AnalysisResult, directory: Path) -> None:
    with (directory / FILENAMES[0]).open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(NODES_COLUMNS)
        writer.writerows(
            (
                node.features.gid,
                node.decision.role,
                node.decision.score,
                node.cluster_id,
                node.priority.score,
                node.decision.evidence,
            )
            for node in result.nodes
        )
    with (directory / FILENAMES[1]).open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(CLUSTERS_COLUMNS)
        writer.writerows(
            (
                cluster.cluster_id,
                cluster.n_nodes,
                cluster.n_seed,
                cluster.sum_kzt_internal,
                json.dumps(cluster.top_gids),
                cluster.hypothesis,
            )
            for cluster in result.clusters
        )
    with (directory / FILENAMES[2]).open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(TOP_COLUMNS)
        writer.writerows(
            (rank, node.features.gid, node.decision.role, node.priority.score, node.priority.why)
            for rank, node in enumerate(result.top_nodes, start=1)
        )


def _publish(staged: Path, output_dir: Path) -> None:
    previous = staged / "previous"
    previous.mkdir()
    for name in FILENAMES:
        target = output_dir / name
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise AnalysisExportError(f"{target}: ожидается обычный файл, не ссылка или каталог")
        if target.exists():
            shutil.copy2(target, previous / name)
    replaced: list[str] = []
    try:
        for name in FILENAMES:
            os.replace(staged / name, output_dir / name)
            replaced.append(name)
    except OSError:
        for name in reversed(replaced):
            if (previous / name).exists():
                os.replace(previous / name, output_dir / name)
            else:
                (output_dir / name).unlink()
        raise


class CsvAnalysisExporter:
    def export(self, result: AnalysisResult, output_dir: Path) -> None:
        try:
            output_dir.mkdir(parents=True, exist_ok=True)
            with TemporaryDirectory(prefix=".analysis-", dir=output_dir) as temporary:
                staged = Path(temporary)
                _write_csvs(result, staged)
                _publish(staged, output_dir)
        except OSError as error:
            raise AnalysisExportError(f"{output_dir}: ошибка записи CSV ({error})") from error
