"""
MINDYARD - Raw Log Schemas
Layer 1: Private Logger のスキーマ
"""
import uuid
from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, Field

from app.models.raw_log import LogIntent, EmotionTag


class RawLogBase(BaseModel):
    """ログ基底スキーマ"""

    content: str = Field(..., min_length=1)
    content_type: str = Field(default="text")


class RawLogCreate(RawLogBase):
    """ログ作成スキーマ"""

    thread_id: Optional[uuid.UUID] = None  # 続きのときはこのスレッドの先頭ログ id


class RawLogUpdate(BaseModel):
    """ログ更新スキーマ"""

    content: Optional[str] = None


class RawLogResponse(RawLogBase):
    """ログレスポンススキーマ"""

    id: uuid.UUID
    user_id: uuid.UUID
    thread_id: Optional[uuid.UUID] = None
    intent: Optional[LogIntent] = None
    emotions: Optional[List[str]] = None
    emotion_scores: Optional[dict] = None
    topics: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    metadata_analysis: Optional[dict] = None
    structural_analysis: Optional[dict] = None
    assistant_reply: Optional[str] = None
    is_analyzed: bool
    is_processed_for_insight: bool
    is_structure_analyzed: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RawLogListResponse(BaseModel):
    """ログリストレスポンス"""

    items: List[RawLogResponse]
    total: int
    page: int
    page_size: int


class DeepResearchInfo(BaseModel):
    """Deep Research タスクの情報（フロントでポーリングに使う）"""
    task_id: str
    status: str = "queued"
    message: str = "詳細な調査をバックグラウンドで実行中です..."


class AckResponse(BaseModel):
    """
    ノン・ジャッジメンタル応答
    「聞く」ことに徹した受容的な相槌 + 会話ラリー用の自然言語返答
    """

    message: str
    log_id: uuid.UUID
    thread_id: uuid.UUID  # スレッドID（フロントが次の送信で使う）
    timestamp: datetime
    transcribed_text: Optional[str] = None  # 音声入力時の文字起こしテキスト
    skip_structural_analysis: bool = False
    conversation_reply: Optional[str] = None  # 会話エージェントが生成した自然な返答（ラリー用）
    deep_research: Optional[DeepResearchInfo] = None  # Deep Research タスク情報

    @classmethod
    def create_ack(
        cls,
        log_id: uuid.UUID,
        thread_id: Optional[uuid.UUID] = None,
        intent: Optional[LogIntent] = None,
        emotions: Optional[List[str]] = None,
        content: Optional[str] = None,
        transcribed_text: Optional[str] = None,
        conversation_reply: Optional[str] = None,
        deep_research: Optional["DeepResearchInfo"] = None,
    ) -> "AckResponse":
        """意図に応じた相槌を生成（conversation_reply がある場合はそれを優先表示用に含める）"""
        # STATE（状態共有）は即時共感のみ、構造分析はスキップ
        if intent == LogIntent.STATE:
            positive_emotions = {"achieved", "excited", "relieved"}
            has_positive_emotion = bool(emotions and any(e in positive_emotions for e in emotions))
            positive_keywords = ("良い", "いい", "最高", "嬉しい", "楽しい", "気持ちいい", "うれしい", "よかった")
            has_positive_keyword = bool(content and any(kw in content for kw in positive_keywords))

            if has_positive_emotion or has_positive_keyword:
                state_message = "いいですね。その気持ち、すてきです。"
            else:
                state_message = "記録しました。お疲れさまです。"

            return cls(
                message=state_message,
                log_id=log_id,
                thread_id=thread_id or log_id,
                timestamp=datetime.now(),
                transcribed_text=transcribed_text,
                skip_structural_analysis=True,
                conversation_reply=conversation_reply,
                deep_research=deep_research,
            )

        ack_messages = {
            LogIntent.LOG: [
                "記録しました。",
                "受け取りました。",
            ],
            LogIntent.VENT: [
                "それは大変でしたね。",
                "お気持ち、受け止めました。",
                "聞かせてくれてありがとうございます。",
            ],
            LogIntent.STRUCTURE: [
                "整理を始めますね。",
                "承知しました。",
            ],
            None: [
                "受領しました。",
            ],
        }

        import random
        messages = ack_messages.get(intent, ack_messages[None])
        message = random.choice(messages)

        return cls(
            message=message,
            log_id=log_id,
            thread_id=thread_id or log_id,
            timestamp=datetime.now(),
            transcribed_text=transcribed_text,
            skip_structural_analysis=False,
            conversation_reply=conversation_reply,
            deep_research=deep_research,
        )
