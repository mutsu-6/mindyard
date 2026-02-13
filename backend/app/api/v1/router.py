"""
MINDYARD - API v1 Router
すべてのエンドポイントを統合
"""
from fastapi import APIRouter

from app.api.v1.endpoints import auth, logs, insights, recommendations, conversation, tasks

api_router = APIRouter()

api_router.include_router(
    auth.router,
    prefix="/auth",
    tags=["認証"],
)

api_router.include_router(
    logs.router,
    prefix="/logs",
    tags=["ログ (Layer 1)"],
)

api_router.include_router(
    conversation.router,
    prefix="/conversation",
    tags=["会話 (LangGraph)"],
)

api_router.include_router(
    insights.router,
    prefix="/insights",
    tags=["インサイト (Layer 3)"],
)

api_router.include_router(
    recommendations.router,
    prefix="/recommendations",
    tags=["レコメンデーション"],
)

api_router.include_router(
    tasks.router,
    prefix="/tasks",
    tags=["タスク (非同期)"],
)
