"""
MINDYARD - Log Endpoints
Layer 1: Private Logger API
"""
import logging
from datetime import datetime
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, Form, HTTPException, Query, status, UploadFile, File
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI

from app.api.deps import get_current_user
from app.db.base import get_async_session
from app.models.user import User
from app.models.raw_log import RawLog, LogIntent
from app.schemas.raw_log import (
    RawLogCreate,
    RawLogResponse,
    RawLogListResponse,
    AckResponse,
    DeepResearchInfo,
)
from app.services.layer1.context_analyzer import context_analyzer
from app.services.layer1.conversation_agent import conversation_agent
from app.services.layer1.situation_router import situation_router
from app.workers.tasks import analyze_log_structure, process_log_for_insight, deep_research_task
from app.core.config import settings

import re

logger = logging.getLogger(__name__)

# Deep Research トリガーキーワード
_DEEP_RESEARCH_KEYWORDS = re.compile(
    r"調査して|リサーチして|調べて|詳しく調べ|深掘りして|研究して|エビデンス|論文|データを集め"
)

router = APIRouter()

# OpenAI クライアント（Whisper用）
_openai_client = None

def get_openai_client() -> AsyncOpenAI:
    """OpenAI クライアントのシングルトン取得"""
    global _openai_client
    if _openai_client is None and settings.openai_api_key:
        _openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client


@router.post("/", response_model=AckResponse, status_code=status.HTTP_201_CREATED)
async def create_log(
    log_in: RawLogCreate,
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    """
    新しいログを作成

    ノン・ジャッジメンタル応答:
    AIは「回答」や「アドバイス」を行わない。
    「聞く」ことに徹し、受容的な相槌（Ack）のみを返す。
    """
    # ログの作成（続きのときは thread_id を指定）
    log = RawLog(
        user_id=current_user.id,
        content=log_in.content,
        content_type=log_in.content_type,
        thread_id=log_in.thread_id,
    )
    session.add(log)
    await session.commit()
    await session.refresh(log)

    # 新規スレッドのときは thread_id を自分自身の id にセット
    if log.thread_id is None:
        log.thread_id = log.id
        await session.commit()
        await session.refresh(log)
    else:
        # 続きのとき: 先頭ログ（id == thread_id）の thread_id が未設定ならセット（旧データ互換）
        if log.thread_id != log.id:
            head = await session.get(RawLog, log.thread_id)
            if head is not None and head.thread_id is None:
                head.thread_id = head.id
                await session.commit()

    # 非同期でContext Analyzerを実行
    # 実際の実装ではCeleryタスクとして実行
    try:
        analysis = await context_analyzer.analyze(log_in.content)
        log.intent = analysis.get("intent")
        log.emotions = analysis.get("emotions")
        log.emotion_scores = analysis.get("emotion_scores")
        log.topics = analysis.get("topics")
        log.tags = analysis.get("tags")
        log.metadata_analysis = analysis.get("metadata_analysis")
        log.is_analyzed = True
        await session.commit()
        await session.refresh(log)
    except Exception:
        # 解析エラーは無視（後でリトライ可能）
        pass

    # 状態共有（STATE）は即時の共感応答のみ返し、構造分析は実行しない
    if log.intent != LogIntent.STATE:
        # 構造分析タスクを非同期でキック（Layer 2）
        try:
            analyze_log_structure.delay(str(log.id))
        except Exception:
            # タスクキューが利用不可でもログ作成は成功させる
            pass

    # 精製所パイプラインをキック（Layer 2: 匿名化 → 構造化 → 共有価値評価 → InsightCard）
    try:
        process_log_for_insight.delay(str(log.id))
    except Exception:
        pass

    # 直前の構造的課題を取得（Situation Router 用）
    # 1. 同一スレッド内を探す → 2. なければスレッド横断で直近ログを参照
    previous_topic = None
    prev_log = None

    # ── 1. 同一スレッド内 ──
    if log.thread_id:
        prev_result = await session.execute(
            select(RawLog)
            .where(
                RawLog.user_id == current_user.id,
                RawLog.thread_id == log.thread_id,
                RawLog.id != log.id,
            )
            .order_by(desc(RawLog.created_at))
            .limit(1)
        )
        prev_log = prev_result.scalar_one_or_none()

    # ── 2. フォールバック: スレッド横断で直近ログ ──
    if prev_log is None:
        fallback_result = await session.execute(
            select(RawLog)
            .where(
                RawLog.user_id == current_user.id,
                RawLog.id != log.id,
            )
            .order_by(desc(RawLog.created_at))
            .limit(1)
        )
        prev_log = fallback_result.scalar_one_or_none()

    if prev_log and prev_log.structural_analysis:
        previous_topic = (
            prev_log.structural_analysis.get("updated_structural_issue")
            or prev_log.structural_analysis.get("structural_issue")
        )

    # 状況をコードで分類し、会話エージェントに渡す
    situation = situation_router.classify(log_in.content, previous_topic)

    # 会話ラリー用の自然な返答を生成（スレッド履歴 + 状況）
    conversation_reply = None
    try:
        conversation_reply = await conversation_agent.generate_reply(
            session, current_user.id, log, situation=situation
        )
        if conversation_reply:
            log.assistant_reply = conversation_reply
            await session.commit()
    except Exception as e:
        logger.warning("create_log: conversation_agent failed: %s", e, exc_info=True)
    if conversation_reply is None:
        logger.info("create_log: conversation_reply not generated (BALANCED LLM / OPENAI_API_KEY may be missing)")

    # ── Deep Research トリガー判定 ──
    # 探究心が高い（STRUCTURE intent）or 明示的なキーワードを含む場合にキック
    deep_research_info = None
    should_deep_research = (
        log.intent == LogIntent.STRUCTURE
        and _DEEP_RESEARCH_KEYWORDS.search(log_in.content)
    ) or (
        _DEEP_RESEARCH_KEYWORDS.search(log_in.content)
        and len(log_in.content) >= 20
    )

    if should_deep_research:
        try:
            task = deep_research_task.delay(
                query=log_in.content,
                user_id=str(current_user.id),
                log_id=str(log.id),
            )
            deep_research_info = DeepResearchInfo(
                task_id=task.id,
                status="queued",
                message="詳細な調査をバックグラウンドで実行中です...",
            )
            logger.info(
                f"Deep research triggered: log_id={log.id}, task_id={task.id}"
            )
        except Exception as e:
            logger.warning(f"Failed to dispatch deep_research_task: {e}")

    # 受容的な相槌を返す
    return AckResponse.create_ack(
        log_id=log.id,
        thread_id=log.thread_id,
        intent=log.intent,
        emotions=log.emotions,
        content=log.content,
        conversation_reply=conversation_reply,
        deep_research=deep_research_info,
    )


@router.get("/", response_model=RawLogListResponse)
async def list_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    """
    ログ一覧を取得（自分のログのみ）
    タイムラインビュー用
    """
    # 総数を取得
    count_result = await session.execute(
        select(func.count(RawLog.id)).where(RawLog.user_id == current_user.id)
    )
    total = count_result.scalar()

    # ページネーション
    offset = (page - 1) * page_size
    result = await session.execute(
        select(RawLog)
        .where(RawLog.user_id == current_user.id)
        .order_by(desc(RawLog.created_at))
        .offset(offset)
        .limit(page_size)
    )
    logs = result.scalars().all()

    return RawLogListResponse(
        items=[RawLogResponse.model_validate(log) for log in logs],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{log_id}", response_model=RawLogResponse)
async def get_log(
    log_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    """特定のログを取得"""
    result = await session.execute(
        select(RawLog).where(
            RawLog.id == log_id,
            RawLog.user_id == current_user.id,
        )
    )
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Log not found",
        )

    return RawLogResponse.model_validate(log)


@router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_log(
    log_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    """ログを削除"""
    result = await session.execute(
        select(RawLog).where(
            RawLog.id == log_id,
            RawLog.user_id == current_user.id,
        )
    )
    log = result.scalar_one_or_none()

    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Log not found",
        )

    await session.delete(log)
    await session.commit()


@router.get("/calendar/{year}/{month}")
async def get_logs_by_month(
    year: int,
    month: int,
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    """
    カレンダービュー用: 月別のログ日付リスト
    """
    from datetime import date
    from sqlalchemy import extract

    result = await session.execute(
        select(
            func.date(RawLog.created_at).label("date"),
            func.count(RawLog.id).label("count"),
        )
        .where(
            RawLog.user_id == current_user.id,
            extract("year", RawLog.created_at) == year,
            extract("month", RawLog.created_at) == month,
        )
        .group_by(func.date(RawLog.created_at))
    )
    rows = result.all()

    return {
        "year": year,
        "month": month,
        "entries": [
            {"date": str(row.date), "count": row.count}
            for row in rows
        ],
    }


@router.post("/transcribe", response_model=AckResponse, status_code=status.HTTP_201_CREATED)
async def transcribe_audio(
    audio: UploadFile = File(...),
    thread_id: Optional[str] = Form(None),
    session: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user),
):
    """
    音声ファイルをWhisper APIで文字起こしし、ログとして保存

    - 音声ファイルを受け取り、OpenAI Whisper APIで文字起こし
    - 文字起こし結果をログとして保存
    - Context Analyzer と Structural Analyzer を実行
    """
    client = get_openai_client()

    if not client:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="音声認識サービスが利用できません。API キーを確認してください。",
        )

    # 音声ファイルの検証
    allowed_types = [
        "audio/webm", "audio/mp4", "audio/mpeg", "audio/mpga",
        "audio/m4a", "audio/wav", "audio/ogg", "audio/flac"
    ]
    if audio.content_type and audio.content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"サポートされていない音声形式です: {audio.content_type}",
        )

    try:
        # 音声ファイルを読み取り
        audio_content = await audio.read()

        # Whisper API で文字起こし
        transcription = await client.audio.transcriptions.create(
            model="whisper-1",
            file=(audio.filename or "audio.webm", audio_content, audio.content_type or "audio/webm"),
            language="ja",  # 日本語を指定
        )

        transcribed_text = transcription.text.strip()

        if not transcribed_text:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="音声を認識できませんでした。もう一度お試しください。",
            )

        # ログの作成（thread_id が指定されていれば同一スレッドに継続）
        parsed_thread_id = uuid.UUID(thread_id) if thread_id else None
        log = RawLog(
            user_id=current_user.id,
            content=transcribed_text,
            content_type="voice",
            thread_id=parsed_thread_id,
        )
        session.add(log)
        await session.commit()
        await session.refresh(log)
        if log.thread_id is None:
            log.thread_id = log.id
            await session.commit()
            await session.refresh(log)

        # Context Analyzer を実行
        try:
            analysis = await context_analyzer.analyze(transcribed_text)
            log.intent = analysis.get("intent")
            log.emotions = analysis.get("emotions")
            log.emotion_scores = analysis.get("emotion_scores")
            log.topics = analysis.get("topics")
            log.tags = analysis.get("tags")
            log.metadata_analysis = analysis.get("metadata_analysis")
            log.is_analyzed = True
            await session.commit()
            await session.refresh(log)
        except Exception:
            # 解析エラーは無視
            pass

        # 状態共有（STATE）は即時の共感応答のみ返し、構造分析は実行しない
        if log.intent != LogIntent.STATE:
            # 構造分析タスクを非同期でキック
            try:
                analyze_log_structure.delay(str(log.id))
            except Exception:
                # タスクキューが利用不可でもログ作成は成功させる
                pass

        # 精製所パイプラインをキック
        try:
            process_log_for_insight.delay(str(log.id))
        except Exception:
            pass

        # 会話ラリー用の自然な返答を生成（音声は状況なしで履歴のみ）
        conversation_reply = None
        try:
            situation = situation_router.classify(transcribed_text, None)
            conversation_reply = await conversation_agent.generate_reply(
                session, current_user.id, log, situation=situation
            )
            if conversation_reply:
                log.assistant_reply = conversation_reply
                await session.commit()
        except Exception:
            pass

        return AckResponse.create_ack(
            log_id=log.id,
            thread_id=log.thread_id,
            intent=log.intent,
            emotions=log.emotions,
            content=log.content,
            transcribed_text=transcribed_text,
            conversation_reply=conversation_reply,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"音声の処理中にエラーが発生しました: {str(e)}",
        )
