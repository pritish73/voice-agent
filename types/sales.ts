import type { LeadState } from '@/lib/sales-engine';

export type ConversationTurn = {
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
};

export type SalesSession = {
  lead: LeadState;
  turns: ConversationTurn[];
};
