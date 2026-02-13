"""
MINDYARD - Celery Tasks
Layer 2 の非同期処理タスク
"""
import asyncio
import logging
from datetime import datetime
from typing import Optional
import uuid
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.workers.celery_app import celery_app
from app.db.base import async_session_maker, engine
from app.models.raw_log import RawLog, LogIntent
from app.models.insight import InsightCard, InsightStatus
from app.services.layer1.context_analyzer import context_analyzer
from app.services.layer2.privacy_sanitizer import privacy_sanitizer
from app.services.layer2.insight_distiller import insight_distiller
from app.services.layer2.sharing_broker import sharing_broker
from app.services.layer2.structural_analyzer import structural_analyzer, is_continuation_phrase
from app.core.config import settings

logger = logging.getLogger(__name__)


def run_async(coro):
    """非同期関数を同期的に実行"""
    loop = asyncio.get_event_loop()
    if loop.is_running():
        # 既存のイベントループがある場合は新しいループを作成
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(asyncio.run, coro)
            return future.result()
    return loop.run_until_complete(coro)


@celery_app.task(bind=True, max_retries=3)
def analyze_log_context(self, log_id: str):
    """
    Layer 1: Context Analyzer タスク
    ログの感情・トピック・インテントを解析
    """
    async def _analyze():
        # Ensure engine connection pool is clean for this process/task
        # This prevents issues with inherited connections in forked processes
        await engine.dispose()

        async with async_session_maker() as session:
            # ログを取得
            result = await session.execute(
                select(RawLog).where(RawLog.id == uuid.UUID(log_id))
            )
            log = result.scalar_one_or_none()

            if not log:
                logger.error(f"Log not found for context analysis: {log_id}")
                return {"status": "error", "message": "Log not found"}

            if log.is_analyzed:
                logger.info(f"Log already analyzed for context: {log_id}")
                return {"status": "skipped", "message": "Already analyzed"}

            try:
                logger.info(f"Starting context analysis for log_id: {log_id}")
                # 解析実行
                analysis = await context_analyzer.analyze(log.content)

                # 結果を保存
                log.intent = analysis.get("intent")
                log.emotions = analysis.get("emotions")
                log.emotion_scores = analysis.get("emotion_scores")
                log.topics = analysis.get("topics")
                log.tags = analysis.get("tags")
                log.metadata_analysis = analysis.get("metadata_analysis")
                log.is_analyzed = True

                # Mark JSON/Array fields as modified to ensure SQLAlchemy detects changes
                flag_modified(log, "emotion_scores")
                flag_modified(log, "metadata_analysis")

                logger.info(f"Committing context analysis for log_id: {log_id}")
                await session.commit()
                logger.info(f"Successfully committed context analysis for log_id: {log_id}")

                return {
                    "status": "success",
                    "log_id": log_id,
                    "intent": str(log.intent) if log.intent else None,
                    "emotions": log.emotions,
                    "tags": log.tags,
                }

            except Exception as e:
                logger.error(f"Error in analyze_log_context for {log_id}: {str(e)}", exc_info=True)
                return {"status": "error", "message": str(e)}

    return run_async(_analyze())


@celery_app.task(bind=True, max_retries=3)
def analyze_log_structure(self, log_id: str):
    """
    Layer 2: Structural Analyzer タスク
    文脈依存型・構造的理解アップデート

    過去の会話履歴と直前の構造的理解を踏まえ、
    新しいログの関係性を判定し構造的課題を更新する。
    """
    async def _analyze_structure():
        # Ensure engine connection pool is clean for this process/task
        await engine.dispose()

        async with async_session_maker() as session:
            # 現在のログを取得
            result = await session.execute(
                select(RawLog).where(RawLog.id == uuid.UUID(log_id))
            )
            log = result.scalar_one_or_none()

            if not log:
                logger.error(f"Log not found for structural analysis: {log_id}")
                return {"status": "error", "message": "Log not found"}

            if log.is_structure_analyzed:
                logger.info(f"Log already analyzed for structure: {log_id}")
                return {"status": "skipped", "message": "Already analyzed for structure"}

            # 状態ログは構造分析をスキップし、マイクロフィードバックを返す
            if log.intent == LogIntent.STATE or log.intent == "state":
                logger.info(f"Generating micro-feedback for state log: {log_id}")
                try:
                    analysis = await structural_analyzer.generate_state_feedback(
                        content=log.content,
                        emotions=log.emotions,
                    )
                    log.structural_analysis = analysis
                    log.is_structure_analyzed = True
                    flag_modified(log, "structural_analysis")
                    await session.commit()
                    logger.info(f"State micro-feedback saved for log_id: {log_id}")
                    return {
                        "status": "success",
                        "log_id": log_id,
                        "relationship_type": analysis.get("relationship_type"),
                        "probing_question": analysis.get("probing_question"),
                    }
                except Exception as e:
                    logger.error(f"Error generating state feedback for {log_id}: {str(e)}", exc_info=True)
                    return {"status": "error", "message": str(e)}

            try:
                logger.info(f"Starting structural analysis for log_id: {log_id}")
                # --- Topic overlap filter to avoid irrelevant history ---
                def _normalize(text: str):
                    tokens = re.split(r"[^\\wぁ-んァ-ン一-龥]+", text.lower())
                    stop = {"の", "に", "と", "で", "が", "は", "を", "も", "へ", "and", "or", "the", "a", "an"}
                    return [t for t in tokens if len(t) > 1 and t not in stop]

                current_tokens = set(_normalize(log.content))
                # 「続きから」「続きで」等のときはトークン重なりで履歴を捨てない（直前ログを必ず使う）
                use_overlap_filter = not is_continuation_phrase(log.content or "")

                # Step 1: 履歴取得 - 同一スレッドがあればそのスレッド内の直近5件、なければ従来どおりユーザー直近5件
                history_query = select(RawLog).where(
                    RawLog.user_id == log.user_id,
                    RawLog.id != log.id,
                ).order_by(RawLog.created_at.desc()).limit(5)
                if getattr(log, "thread_id", None) is not None:
                    history_query = history_query.where(RawLog.thread_id == log.thread_id)
                history_result = await session.execute(history_query)
                candidates = history_result.scalars().all()

                past_logs = []
                for prev in candidates:
                    if use_overlap_filter:
                        overlap = current_tokens & set(_normalize(prev.content))
                        if overlap:
                            past_logs.append(prev)
                        else:
                            logger.info(f"[structural] skip history log {prev.id} (no topical overlap)")
                    else:
                        past_logs.append(prev)

                # Step 2: 前回仮説の抽出
                previous_hypothesis = None
                if past_logs:
                    latest_prev_log = past_logs[0]
                    if latest_prev_log.structural_analysis:
                        # updated_structural_issue を優先、なければ structural_issue
                        previous_hypothesis = (
                            latest_prev_log.structural_analysis.get("updated_structural_issue")
                            or latest_prev_log.structural_analysis.get("structural_issue")
                        )

                # Step 3: 要約リスト作成
                recent_history = []
                for prev_log in past_logs:
                    # コンテンツを短く切り詰める（100文字まで）
                    summary = prev_log.content[:100]
                    if len(prev_log.content) > 100:
                        summary += "..."
                    recent_history.append(summary)

                # Step 4: 感情スコアの最大値を取得
                max_emotion_score = 0.0
                if log.emotion_scores and isinstance(log.emotion_scores, dict):
                    scores = log.emotion_scores.values()
                    max_emotion_score = max(scores) if scores else 0.0

                # Step 5: StructuralAnalyzer 実行
                analysis = await structural_analyzer.analyze(
                    current_log=log.content,
                    recent_history=recent_history if recent_history else None,
                    previous_hypothesis=previous_hypothesis,
                    max_emotion_score=max_emotion_score,
                )

                # 結果を保存
                log.structural_analysis = analysis
                # Explicitly set the completion flag
                log.is_structure_analyzed = True

                # Mark JSON fields as modified to ensure SQLAlchemy detects changes
                flag_modified(log, "structural_analysis")

                logger.info(f"Committing structural analysis for log_id: {log_id}")
                await session.commit()
                logger.info(f"Successfully committed structural analysis for log_id: {log_id}")

                return {
                    "status": "success",
                    "log_id": log_id,
                    "relationship_type": analysis.get("relationship_type"),
                    "updated_structural_issue": analysis.get("updated_structural_issue"),
                    "probing_question": analysis.get("probing_question"),
                }

            except Exception as e:
                logger.error(f"Error in analyze_log_structure for {log_id}: {str(e)}", exc_info=True)
                return {"status": "error", "message": str(e)}

    return run_async(_analyze_structure())


# ════════════════════════════════════════
# 品質ゲート: Insight化する価値があるかの事前チェック
# ════════════════════════════════════════
_MIN_CONTENT_LENGTH = 30  # これ未満はInsight化しない
_TRIVIAL_PATTERNS = {
    "おはよう", "おやすみ", "ありがとう", "了解", "OK", "ok", "はい",
    "テスト", "test", "あ", "うん", "そう", "なるほど",
}


def _check_insight_eligibility(log: RawLog) -> Optional[str]:
    """
    ログがInsight化に値するかチェックする。
    不適格なら理由文字列を返す。適格なら None を返す。
    """
    content = (log.content or "").strip()

    # 1. 短すぎるログ
    if len(content) < _MIN_CONTENT_LENGTH:
        return f"too_short ({len(content)} < {_MIN_CONTENT_LENGTH})"

    # 2. STATE（状態記録）は知恵にならない
    if log.intent and log.intent.value == "state":
        return "intent_is_state"

    # 3. 定型的・意味のない投稿
    normalized = content.replace("。", "").replace("！", "").replace("？", "").strip()
    if normalized in _TRIVIAL_PATTERNS:
        return f"trivial_content: {normalized}"

    # 4. 数字だけ・記号だけ
    if re.fullmatch(r"[\d\s\W]+", content):
        return "numeric_or_symbols_only"

    return None


@celery_app.task(bind=True, max_retries=3)
def process_log_for_insight(self, log_id: str):
    """
    Layer 2: Gateway Refinery タスク
    品質ゲート → 匿名化 → 構造化 → 評価 → 保存
    """
    async def _process():
        # Ensure engine connection pool is clean for this process/task
        await engine.dispose()

        async with async_session_maker() as session:
            # ログを取得
            result = await session.execute(
                select(RawLog).where(RawLog.id == uuid.UUID(log_id))
            )
            log = result.scalar_one_or_none()

            if not log:
                logger.error(f"Log not found for insight processing: {log_id}")
                return {"status": "error", "message": "Log not found"}

            if log.is_processed_for_insight:
                logger.info(f"Log already processed for insight: {log_id}")
                return {"status": "skipped", "message": "Already processed"}

            # ── 品質ゲート: Insight化する価値があるかを事前チェック ──
            skip_reason = _check_insight_eligibility(log)
            if skip_reason:
                log.is_processed_for_insight = True
                await session.commit()
                logger.info(
                    f"Insight skipped (quality gate): log_id={log_id}, reason={skip_reason}"
                )
                return {"status": "skipped", "message": skip_reason}

            try:
                logger.info(f"Starting insight processing for log_id: {log_id}")
                # Step 1: Privacy Sanitizer - 匿名化
                sanitized_content, sanitize_metadata = await privacy_sanitizer.sanitize(
                    log.content
                )

                # Step 2: Insight Distiller - 構造化・抽象化
                distilled = await insight_distiller.distill(
                    sanitized_content,
                    metadata={
                        "intent": str(log.intent) if log.intent else None,
                        "emotions": log.emotions,
                        "topics": log.topics,
                        "tags": log.tags,
                    }
                )

                # Step 2.5: Distiller が「知恵にならない」と判断した場合はスキップ
                if distilled.get("not_suitable"):
                    log.is_processed_for_insight = True
                    await session.commit()
                    logger.info(
                        f"Insight skipped (distiller: not_suitable): log_id={log_id}"
                    )
                    return {"status": "skipped", "message": "not_suitable_for_wisdom"}

                # Step 3: Sharing Broker - 評価
                evaluation = await sharing_broker.evaluate_sharing_value(distilled)

                sharing_score = evaluation.get("sharing_value_score", 0)
                should_propose = evaluation.get("should_propose", False)

                # Step 4: ステータス判定
                #   score >= 80 → 推奨（ユーザーに共有を提案）
                #   score <  80 → 通常（保存のみ）
                #   ※ 公開はユーザーの承認が必須。自動公開は行わない。
                if should_propose:
                    insight_status = InsightStatus.PENDING_APPROVAL
                else:
                    insight_status = InsightStatus.DRAFT

                insight = InsightCard(
                    author_id=log.user_id,
                    source_log_id=log.id,
                    title=distilled.get("title", ""),
                    context=distilled.get("context"),
                    problem=distilled.get("problem"),
                    solution=distilled.get("solution"),
                    summary=distilled.get("summary", ""),
                    topics=distilled.get("topics"),
                    tags=distilled.get("tags"),
                    sharing_value_score=sharing_score,
                    novelty_score=evaluation.get("novelty_score", 0),
                    generality_score=evaluation.get("generality_score", 0),
                    status=insight_status,
                )

                session.add(insight)
                log.is_processed_for_insight = True

                logger.info(f"Committing insight processing for log_id: {log_id}")
                await session.commit()
                logger.info(f"Successfully committed insight processing for log_id: {log_id}")

                await session.refresh(insight)

                promotion_type = "推奨" if should_propose else "通常"
                logger.info(
                    f"Insight pipeline complete: log_id={log_id}, "
                    f"insight_id={insight.id}, score={sharing_score}, "
                    f"type={promotion_type}"
                )

                return {
                    "status": "success",
                    "log_id": log_id,
                    "insight_id": str(insight.id),
                    "should_propose": should_propose,
                    "sharing_value_score": sharing_score,
                    "promotion_type": promotion_type,
                }

            except Exception as e:
                logger.error(f"Error in process_log_for_insight for {log_id}: {str(e)}", exc_info=True)
                return {"status": "error", "message": str(e)}

    return run_async(_process())


@celery_app.task(bind=True, max_retries=3)
def deep_research_task(self, query: str, user_id: str, log_id: str = ""):
    """
    Deep Research タスク: DEEPモデルで詳細調査 → DB保存 → 共有知に自動登録

    コストの高いDeep Researchは自動的に共有知（みんなの知恵）に分類され、
    全体共有されて重複を避ける仕組み。
    """
    async def _research():
        await engine.dispose()

        try:
            logger.info(
                f"Starting deep research for user_id: {user_id}, query: {query[:100]}"
            )

            from app.core.llm import llm_manager
            from app.core.llm_provider import LLMUsageRole

            provider = llm_manager.get_client(LLMUsageRole.DEEP)
            await provider.initialize()

            system_prompt = """あなたは詳細な調査・リサーチを行うアシスタントです。
以下の質問について、深く掘り下げた包括的な調査レポートを作成してください。

レポートのフォーマット:
## 概要
質問への総合的な回答（2-3文）

## 詳細分析
各論点の掘り下げ（箇条書き + 説明）

## エビデンス
根拠となる情報・データ・数値

## 結論と推奨
まとめと次のアクション

日本語で応答してください。"""

            result = await provider.generate_text(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": query},
                ],
                temperature=0.3,
            )

            report = result.content
            logger.info(f"Deep research completed for user_id: {user_id}")

            # ── DB保存: ログの structural_analysis に deep_research を格納 ──
            if log_id:
                try:
                    async with async_session_maker() as session:
                        log_result = await session.execute(
                            select(RawLog).where(RawLog.id == uuid.UUID(log_id))
                        )
                        log = log_result.scalar_one_or_none()
                        if log:
                            existing = log.structural_analysis or {}
                            existing["deep_research"] = {
                                "report": report,
                                "completed_at": datetime.utcnow().isoformat(),
                            }
                            log.structural_analysis = existing
                            await session.commit()
                            logger.info(f"Deep research saved to log: {log_id}")
                except Exception as e:
                    logger.warning(f"Failed to save deep research to log: {e}")

            # ── 共有知に自動登録（コストの高い調査は重複を避けるため共有） ──
            try:
                from app.services.layer3.knowledge_store import knowledge_store

                await knowledge_store.store_insight({
                    "id": f"dr-{log_id or uuid.uuid4().hex[:8]}",
                    "title": f"調査: {query[:50]}",
                    "summary": report[:500] if report else "",
                    "topics": [],
                    "tags": ["deep_research"],
                    "content": report,
                })
                logger.info(
                    f"Deep research auto-shared to knowledge store: log_id={log_id}"
                )
            except Exception as e:
                logger.warning(f"Failed to store deep research in knowledge store: {e}")

            return {
                "status": "success",
                "user_id": user_id,
                "query": query,
                "report": report,
                "log_id": log_id,
            }

        except Exception as e:
            logger.error(
                f"Error in deep_research_task for user_id {user_id}: {str(e)}",
                exc_info=True,
            )
            return {"status": "error", "message": str(e)}

    return run_async(_research())


@celery_app.task
def process_all_unprocessed_logs():
    """
    未処理のログをすべて処理するバッチタスク
    """
    async def _process_all():
        # Ensure engine connection pool is clean for this process/task
        await engine.dispose()

        async with async_session_maker() as session:
            # 未処理のログを取得
            result = await session.execute(
                select(RawLog).where(
                    RawLog.is_analyzed == True,
                    RawLog.is_processed_for_insight == False,
                ).limit(100)  # バッチサイズ
            )
            logs = result.scalars().all()

            processed = []
            for log in logs:
                # 個別タスクをキューに追加
                process_log_for_insight.delay(str(log.id))
                processed.append(str(log.id))

            return {
                "status": "success",
                "queued_count": len(processed),
                "log_ids": processed,
            }

    return run_async(_process_all())
