"""
MINDYARD - Task Status Endpoints
Celery非同期タスクのステータス確認API
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional

from app.api.deps import get_current_user
from app.models.user import User
from app.workers.celery_app import celery_app

router = APIRouter()


class TaskStatusResponse(BaseModel):
    """タスクステータスレスポンス"""
    task_id: str
    status: str  # PENDING, STARTED, SUCCESS, FAILURE, RETRY, REVOKED
    result: Optional[dict] = None
    error: Optional[str] = None


@router.get("/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(
    task_id: str,
    current_user: User = Depends(get_current_user),
):
    """
    Celeryタスクのステータスを確認する。
    Deep Research 等の非同期タスクの完了状態をフロントからポーリングで取得する。
    """
    result = celery_app.AsyncResult(task_id)

    response = TaskStatusResponse(
        task_id=task_id,
        status=result.status,
    )

    if result.status == "SUCCESS":
        task_result = result.result
        if isinstance(task_result, dict):
            # user_id チェック: 他のユーザーのタスク結果は見せない
            if task_result.get("user_id") and task_result["user_id"] != str(current_user.id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied",
                )
            response.result = task_result
    elif result.status == "FAILURE":
        response.error = str(result.result) if result.result else "Unknown error"

    return response
