import type { Poll } from "../types";
import { supabase } from "./supabase";

/**
 * Голоса в опросах.
 *
 * Сам вопрос и варианты зашифрованы внутри сообщения, а голоса лежат в
 * отдельной таблице `zero_poll_votes` — так их видят все участники чата и
 * они сохраняются между перезагрузками. Уникальность (poll_id, voter_email)
 * не даёт проголосовать дважды.
 */
export const POLL_VOTES_TABLE = "zero_poll_votes";

export interface PollVoteRow {
  poll_id: string;
  option_id: string;
  voter_email: string;
  created_at?: string;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function pollIdOf(poll: Poll | undefined, fallback: string) {
  return poll?.id?.trim() || fallback;
}

/** Загружает голоса для набора опросов. */
export async function loadPollVotes(pollIds: string[]): Promise<PollVoteRow[]> {
  const ids = [...new Set(pollIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from(POLL_VOTES_TABLE)
    .select("poll_id,option_id,voter_email,created_at")
    .in("poll_id", ids);
  if (error) throw error;
  return (data ?? []) as PollVoteRow[];
}

/** Пересчитывает проценты и отметку «мой голос» по голосам из базы. */
export function applyPollVotes(
  poll: Poll,
  votes: PollVoteRow[],
  meEmail: string,
): Poll {
  const me = normalizeEmail(meEmail);
  const mine = votes.find((vote) => normalizeEmail(vote.voter_email) === me);
  const counts = new Map<string, number>();
  for (const vote of votes) {
    counts.set(vote.option_id, (counts.get(vote.option_id) ?? 0) + 1);
  }
  return {
    ...poll,
    options: poll.options.map((option) => ({
      ...option,
      votes: counts.get(option.id) ?? 0,
      voted: mine?.option_id === option.id,
    })),
  };
}

/** Голосует за вариант; повторное нажатие по тому же варианту убирает голос. */
export async function castPollVote(input: {
  pollId: string;
  optionId: string;
  voterEmail: string;
}): Promise<{ voted: boolean }> {
  const pollId = input.pollId.trim();
  const optionId = input.optionId.trim();
  const voter = normalizeEmail(input.voterEmail);
  if (!pollId || !optionId || !voter) return { voted: false };

  const { data, error } = await supabase
    .from(POLL_VOTES_TABLE)
    .select("option_id")
    .eq("poll_id", pollId)
    .eq("voter_email", voter)
    .maybeSingle<{ option_id: string }>();
  if (error) throw error;

  if (data?.option_id === optionId) {
    const { error: removeError } = await supabase
      .from(POLL_VOTES_TABLE)
      .delete()
      .eq("poll_id", pollId)
      .eq("voter_email", voter);
    if (removeError) throw removeError;
    return { voted: false };
  }

  // Сначала убираем старый выбор (single choice), затем вставляем новый.
  const { error: clearError } = await supabase
    .from(POLL_VOTES_TABLE)
    .delete()
    .eq("poll_id", pollId)
    .eq("voter_email", voter);
  if (clearError) throw clearError;

  const { error: insertError } = await supabase
    .from(POLL_VOTES_TABLE)
    .insert({ poll_id: pollId, option_id: optionId, voter_email: voter });
  if (insertError) throw insertError;
  return { voted: true };
}

/** Подписка на изменения голосов в реальном времени. */
export function subscribePollVotes(onChange: (pollId: string) => void) {
  const channel = supabase.channel("zero-polls");
  const handle = (payload: { new?: Partial<PollVoteRow>; old?: Partial<PollVoteRow> }) => {
    const pollId = payload.new?.poll_id || payload.old?.poll_id;
    if (pollId) onChange(pollId);
  };
  channel
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: POLL_VOTES_TABLE },
      handle,
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: POLL_VOTES_TABLE },
      handle,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: POLL_VOTES_TABLE },
      handle,
    );
  channel.subscribe();
  return channel;
}
