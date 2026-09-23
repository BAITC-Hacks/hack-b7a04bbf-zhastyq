import argparse
import json
import sys
from pathlib import Path

import uvicorn

from money_graph.application.use_cases import AnalysisError
from money_graph.composition import make_service
from money_graph.presentation.api import create_app


def main() -> None:
    parser = argparse.ArgumentParser(prog="money-graph")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("analyze", "serve"):
        command = sub.add_parser(name)
        command.add_argument("--data-dir", type=Path)
        command.add_argument("--nodes", type=Path)
        command.add_argument("--edges", type=Path)
        command.add_argument("--transactions", type=Path)
        command.add_argument("--out", type=Path, default=Path("out"))
        if name == "serve":
            command.add_argument("--host", default="127.0.0.1")
            command.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    try:
        service, publisher = make_service(args.out)
        selected = {name: getattr(args, name) for name in ("nodes", "edges", "transactions")}
        if args.data_dir is not None:
            for name in selected:
                if selected[name] is None:
                    candidates = [args.data_dir / f"{name}.{suffix}" for suffix in ("parquet", "csv")]
                    selected[name] = next((p for p in candidates if p.exists()), None)
        if args.command == "analyze" or any(value is not None for value in selected.values()):
            paths = {name: str(value) for name, value in selected.items() if value is not None}
            result = service.analyze(paths)
            print(json.dumps({"analysis_id": result.analysis_id, "summary": result.summary,
                              "output_dir": str(args.out)}, ensure_ascii=False))
        if args.command == "serve":
            uvicorn.run(create_app(service, publisher), host=args.host, port=args.port)
    except (AnalysisError, OSError, ValueError) as exc:
        print(f"Ошибка: {exc}", file=sys.stderr)
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
