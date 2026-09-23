from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from money_graph.presentation.api.dependencies import ApiServices
from money_graph.presentation.api.exception_handlers import register_handlers
from money_graph.presentation.api.routers import analysis, exports, health, nodes


class RequestSizeLimit:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        size = 0

        async def limited_receive() -> Message:
            nonlocal size
            message = await receive()
            if message["type"] == "http.request":
                size += len(message.get("body", b""))
                if size > self.max_bytes:
                    raise HTTPException(413)
            return message

        await self.app(scope, limited_receive, send)


def create_app(
    use_cases: ApiServices,
    cors_origins: tuple[str, ...] = (),
    max_file_bytes: int = 25 * 1024 * 1024,
) -> FastAPI:
    app = FastAPI(title="Граф денег", version="0.3.0")
    app.state.services = use_cases
    register_handlers(app)
    for router in (health.router, analysis.router, nodes.router, exports.router):
        app.include_router(router)
    app.add_middleware(RequestSizeLimit, max_bytes=3 * max_file_bytes + 1024 * 1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        expose_headers=["Content-Disposition", "X-Analysis-Id"],
    )
    return app
