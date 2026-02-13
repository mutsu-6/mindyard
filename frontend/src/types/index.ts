/**
 * MINDYARD - Type Definitions
 */

// User
export interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface Token {
  access_token: string;
  token_type: string;
  user: User;
}

// Log Intent
export type LogIntent = 'log' | 'vent' | 'structure' | 'state';

// Model Info
export interface ModelInfo {
  tier: 'deep' | 'balanced' | 'fast';
  model: string;
  is_reasoning: boolean;
}

// Structural Analysis Result
export interface StructuralAnalysis {
  relationship_type: 'ADDITIVE' | 'PARALLEL' | 'CORRECTION' | 'NEW';
  relationship_reason: string;
  updated_structural_issue: string;
  probing_question: string;
  model_info?: ModelInfo;  // 使用したモデル情報
}

// Raw Log (Layer 1)
export interface RawLog {
  id: string;
  user_id: string;
  thread_id: string | null;  // 同一会話の先頭ログ id（続きのとき）
  content: string;
  content_type: string;
  intent: LogIntent | null;
  emotions: string[] | null;
  emotion_scores: Record<string, number> | null;
  topics: string[] | null;
  structural_analysis: StructuralAnalysis | null;
  assistant_reply: string | null;  // 会話エージェントの自然言語返答
  is_analyzed: boolean;
  is_processed_for_insight: boolean;
  is_structure_analyzed: boolean;
  created_at: string;
  updated_at: string;
}

export interface RawLogListResponse {
  items: RawLog[];
  total: number;
  page: number;
  page_size: number;
}

export interface DeepResearchInfo {
  task_id: string;
  status: string;
  message: string;
}

export interface AckResponse {
  message: string;
  log_id: string;
  thread_id: string;  // スレッドID（次の送信で継続するために使用）
  timestamp: string;
  transcribed_text?: string;  // 音声入力時の文字起こしテキスト
  skip_structural_analysis?: boolean;
  conversation_reply?: string; // 会話エージェントが生成した自然な返答（ラリー用）
  deep_research?: DeepResearchInfo | null;  // Deep Research タスク情報
}

export interface TaskStatusResponse {
  task_id: string;
  status: string;  // PENDING, STARTED, SUCCESS, FAILURE
  result?: {
    status: string;
    report?: string;
    query?: string;
    log_id?: string;
    [key: string]: unknown;
  };
  error?: string;
}

// Insight Card (Layer 3)
export type InsightStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';

export interface InsightCard {
  id: string;
  author_id: string;
  title: string;
  context: string | null;
  problem: string | null;
  solution: string | null;
  summary: string;
  topics: string[] | null;
  tags: string[] | null;
  sharing_value_score: number;
  status: InsightStatus;
  view_count: number;
  thanks_count: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface InsightCardListResponse {
  items: InsightCard[];
  total: number;
  page: number;
  page_size: number;
}

export interface SharingProposal {
  insight: InsightCard;
  message: string;
  original_content_preview: string | null;
}

// Conversation (LangGraph Hypothesis-Driven Routing)
export type ConversationIntent = 'chat' | 'empathy' | 'knowledge' | 'deep_dive' | 'brainstorm' | 'probe';

export type PreviousEvaluation = 'positive' | 'negative' | 'pivot' | 'none';

export interface IntentHypothesis {
  previous_evaluation: PreviousEvaluation;
  primary_intent: ConversationIntent;
  primary_confidence: number;
  secondary_intent: ConversationIntent;
  secondary_confidence: number;
  needs_probing: boolean;
  reasoning: string;
}

export interface IntentBadge {
  intent: ConversationIntent;
  confidence: number;
  label: string;
  icon: string;
}

export type BackgroundTaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface BackgroundTask {
  task_id: string;
  task_type: string;
  status: BackgroundTaskStatus;
  message: string;
}

export interface ConversationRequest {
  message: string;
  mode_override?: ConversationIntent;
}

export interface ConversationResponse {
  response: string;
  intent_badge: IntentBadge;
  background_task: BackgroundTask | null;
  user_id: string;
  timestamp: string;
}

// Recommendations
export interface RecommendationItem {
  id: string;
  title: string;
  summary: string;
  topics: string[];
  relevance_score: number;
  preview: string;
}

export interface RecommendationResponse {
  has_recommendations: boolean;
  recommendations: RecommendationItem[];
  trigger_reason: string;
  display_message: string | null;
}
