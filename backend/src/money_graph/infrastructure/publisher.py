import csv
import json
import os
import tempfile
from pathlib import Path
from typing import Any

from money_graph.application.ports import Analysis


EXPORTS = {
    "nodes_roles.csv": ["gid", "role", "role_score", "cluster_id", "priority_score", "evidence", "depth",
                        "is_seed", "in_deg", "out_deg", "in_kzt", "out_kzt", "in_tx", "out_tx", "truncated_by_depth"],
    "clusters.csv": ["cluster_id", "n_nodes", "n_seed", "sum_kzt_internal", "top_gids", "hypothesis"],
    "top_nodes.csv": ["rank", "gid", "role", "priority_score", "why"],
}


class FilePublisher:
    def __init__(self, output_dir: Path):
        self.output_dir = output_dir

    def publish(self, analysis: Analysis) -> None:
        versions = self.output_dir / "analyses"
        versions.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=".stage-", dir=versions))
        for name, columns in EXPORTS.items():
            rows = {"nodes_roles.csv": analysis.nodes, "clusters.csv": analysis.clusters,
                    "top_nodes.csv": analysis.top_nodes}[name]
            with (stage / name).open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
                writer.writeheader()
                for row in rows:
                    writer.writerow({key: json.dumps(value, ensure_ascii=False) if isinstance(value, list) else value
                                     for key, value in row.items()})
        (stage / "viewer_data.json").write_text(json.dumps(analysis.screen(), ensure_ascii=False), encoding="utf-8")
        final = versions / analysis.analysis_id
        os.replace(stage, final)
        pointer = self.output_dir / f".current-{analysis.analysis_id}"
        pointer.symlink_to(Path("analyses") / analysis.analysis_id, target_is_directory=True)
        os.replace(pointer, self.output_dir / "current")
        for name in (*EXPORTS, "viewer_data.json"):
            link = self.output_dir / name
            if not link.exists() and not link.is_symlink():
                link.symlink_to(Path("current") / name)

    def load(self) -> Analysis | None:
        path = self.output_dir / "current" / "viewer_data.json"
        if not path.exists():
            return None
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        fixed = {key: data.pop(key) for key in ("analysis_id", "summary", "nodes", "edges", "clusters", "top_nodes")}
        return Analysis(**fixed, extras=data)

    def export_path(self, name: str) -> Path:
        if name not in EXPORTS:
            raise ValueError("Неизвестная выгрузка")
        return self.output_dir / "current" / name
